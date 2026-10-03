import { PauseWindow, Schedule, ScheduleInput, ScheduleRules } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Db } from "../db";
import { actor, requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { audit } from "../services/audit";
import type { NewsCalendar } from "../services/news-calendar";
import {
  instanceIds,
  invalidRules,
  listSchedules,
  scheduleNameTaken,
  setLinks,
  upcomingPauses,
} from "../services/schedules";

const IdParams = Type.Object({ id: Type.Integer() });

/** Schedules (weekends, holidays, news pauses) and which instances use them; services/scheduler.ts applies them. */
export const scheduleRoutes: FastifyPluginAsyncTypebox<{ db: Db; news: NewsCalendar; brokerId: string }> = async (
  app,
  { db, news, brokerId },
) => {
  /** The trimmed name, or the error of the input: rules the schema cannot check, a name another schedule has. */
  async function checked(input: ScheduleInput, except?: number) {
    const name = input.name.trim();
    const problem = invalidRules(input.rules);
    if (problem) return { ok: false, status: 400, error: problem } as const;
    if (!name || (await scheduleNameTaken(db, name, except))) {
      return { ok: false, status: 409, error: "schedule_exists" } as const;
    }
    const ids = input.instances && (await instanceIds(db, input.instances));
    if (ids === undefined && input.instances) return { ok: false, status: 404, error: "instance_not_found" } as const;
    return { ok: true, name, instanceIds: ids } as const;
  }

  app.get(
    "/schedules",
    {
      schema: {
        tags: ["schedules"],
        summary: "Schedules with the instances that use them and their current or next pause",
        response: { 200: Type.Array(Schedule) },
      },
    },
    () => listSchedules(db, news),
  );

  app.get(
    "/schedules/instances",
    {
      schema: {
        tags: ["schedules"],
        summary: "The names of the instances a schedule can pause: those set up in wickwatch",
        response: { 200: Type.Array(Type.String()) },
      },
    },
    async () =>
      (
        await db
          .selectFrom("instances")
          .innerJoin("accounts", "accounts.id", "instances.account_id")
          .select("instances.name")
          .where("accounts.adapter", "=", brokerId)
          .orderBy("instances.name")
          .execute()
      ).map((r) => r.name),
  );

  app.post(
    "/schedules/preview",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["schedules"],
        summary: "The pauses of the next 14 days that rules would make, before they are saved",
        description: "News pauses only with the events of the calendar fetched so far (NEWS_CALENDAR_URL).",
        body: Type.Object({ rules: ScheduleRules }),
        response: { 200: Type.Array(PauseWindow), 400: ErrorBody, 403: ErrorBody },
      },
    },
    async (request, reply) => {
      const problem = invalidRules(request.body.rules);
      if (problem) return reply.code(400).send({ error: problem });
      return upcomingPauses(news, request.body.rules);
    },
  );

  app.post(
    "/schedules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["schedules"],
        summary: "Create a schedule",
        body: ScheduleInput,
        response: { 201: Schedule, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
      },
    },
    async (request, reply) => {
      const input = await checked(request.body);
      if (!input.ok) return reply.code(input.status).send({ error: input.error });
      const { name } = input;
      const { rules } = request.body;
      const now = new Date().toISOString();
      const userId = request.user?.id ?? null;
      const { id } = await db
        .insertInto("schedules")
        .values({
          name,
          rules: JSON.stringify(rules),
          created_by: userId,
          created_at: now,
          updated_by: userId,
          updated_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const { instances } = request.body;
      if (input.instanceIds) await setLinks(db, { scheduleId: id }, input.instanceIds);
      await audit(db, {
        action: "schedule.create",
        target: name,
        details: { rules, ...(instances ? { instances } : {}) },
        ...actor(request),
      });
      const [created] = await listSchedules(db, news, id);
      if (!created) throw new Error(`Schedule ${String(id)} vanished`);
      return reply.code(201).send(created);
    },
  );

  app.put(
    "/schedules/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["schedules"],
        summary: "Change a schedule; its instances follow at the next check",
        params: IdParams,
        body: ScheduleInput,
        response: { 200: Schedule, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await db.selectFrom("schedules").select("id").where("id", "=", id).executeTakeFirst())) {
        return reply.code(404).send({ error: "not_found" });
      }
      const input = await checked(request.body, id);
      if (!input.ok) return reply.code(input.status).send({ error: input.error });
      const { name } = input;
      const { rules } = request.body;
      await db
        .updateTable("schedules")
        .set({
          name,
          rules: JSON.stringify(rules),
          updated_by: request.user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", id)
        .execute();
      const { instances } = request.body;
      if (input.instanceIds) await setLinks(db, { scheduleId: id }, input.instanceIds);
      await audit(db, {
        action: "schedule.update",
        target: name,
        details: { rules, ...(instances ? { instances } : {}) },
        ...actor(request),
      });
      const [updated] = await listSchedules(db, news, id);
      return updated;
    },
  );

  app.delete(
    "/schedules/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["schedules"],
        summary: "Delete a schedule",
        description: "Its instances keep running without one; instances it paused are started at the next check.",
        params: IdParams,
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const row = await db
        .selectFrom("schedules")
        .select("name")
        .where("id", "=", request.params.id)
        .executeTakeFirst();
      if (!row) return reply.code(404).send({ error: "not_found" });
      // Its instances lose it by the foreign key; instances it paused are started at the next check.
      await db.deleteFrom("schedules").where("id", "=", request.params.id).execute();
      await audit(db, { action: "schedule.delete", target: row.name, ...actor(request) });
      return reply.code(204).send(null);
    },
  );
};
