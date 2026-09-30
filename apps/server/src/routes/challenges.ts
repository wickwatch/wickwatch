import { ChallengeProfile, ChallengeTemplate, isTimeZone } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { readProfile } from "../challenges/store";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { audit } from "../services/audit";

export interface ChallengeRouteOptions {
  db: Db;
  templates: ChallengeTemplate[];
  /** Runs after a save, e.g. to mark the trading days since the (new) start date right away. */
  onSaved?: (accountId: number) => void;
}

const Params = Type.Object({ number: Type.String({ minLength: 1 }) });

export const challengeRoutes: FastifyPluginAsyncTypebox<ChallengeRouteOptions> = async (
  app,
  { db, templates, onSaved },
) => {
  const accountId = async (number: string) =>
    (await db.selectFrom("accounts").select("id").where("number", "=", number).executeTakeFirst())?.id;

  app.get(
    "/challenge-templates",
    {
      schema: {
        tags: ["accounts"],
        summary: "Challenge templates from templates/challenges/*.json",
        response: { 200: Type.Array(ChallengeTemplate) },
      },
    },
    () => templates,
  );

  app.get(
    "/accounts/:number/challenge",
    {
      schema: {
        tags: ["accounts"],
        summary: "The account's challenge profile",
        params: Params,
        response: { 200: ChallengeProfile, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const id = await accountId(request.params.number);
      const profile = id === undefined ? undefined : await readProfile(db, id);
      return profile ?? reply.code(404).send({ error: "not_found" });
    },
  );

  app.put(
    "/accounts/:number/challenge",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Set or replace the account's challenge profile",
        params: Params,
        body: ChallengeProfile,
        response: { 200: ChallengeProfile, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const profile = request.body;
      const id = await accountId(request.params.number);
      if (id === undefined) return reply.code(404).send({ error: "not_found" });
      if (profile.rules.dailyLoss && !isTimeZone(profile.rules.dailyLoss.timezone)) {
        return reply.code(400).send({ error: "invalid_timezone" });
      }
      if (profile.templateId && !templates.some((t) => t.id === profile.templateId)) {
        return reply.code(400).send({ error: "template_not_found" });
      }
      const now = new Date().toISOString();
      const row = { template_id: profile.templateId ?? null, profile: JSON.stringify(profile), updated_at: now };
      await db
        .insertInto("challenge_profiles")
        .values({ account_id: id, ...row, created_at: now })
        .onConflict((oc) => oc.column("account_id").doUpdateSet(row))
        .execute();
      await audit(db, {
        action: "challenge.save",
        target: request.params.number,
        details: { name: profile.name, templateId: profile.templateId ?? null },
        userId: request.user?.id,
      });
      onSaved?.(id);
      return profile;
    },
  );

  app.delete(
    "/accounts/:number/challenge",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Remove the account's challenge profile",
        params: Params,
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const id = await accountId(request.params.number);
      const result =
        id === undefined
          ? undefined
          : await db.deleteFrom("challenge_profiles").where("account_id", "=", id).executeTakeFirst();
      if (!result?.numDeletedRows) return reply.code(404).send({ error: "not_found" });
      await audit(db, { action: "challenge.delete", target: request.params.number, userId: request.user?.id });
      return reply.code(204).send(null);
    },
  );
};
