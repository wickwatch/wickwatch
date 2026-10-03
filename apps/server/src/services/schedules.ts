import {
  isTimeZone,
  pauseWindows,
  PauseReason,
  ScheduleRules,
  type InstancePause,
  type PauseWindow,
  type Schedule,
} from "@wickwatch/core";
import { groupBy } from "@wickwatch/core/group-by";
import Value from "typebox/value";
import type { Db } from "../db";
import type { NewsCalendar } from "./news-calendar";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead the next pause is looked for, and what a preview shows. */
export const AHEAD_MS = 14 * DAY_MS;

/** A schedule's rules from their JSON; undefined if unreadable. */
export function rulesOf(json: string): ScheduleRules | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return Value.Check(ScheduleRules, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The pause of an instance its schedules hold stopped, from its row. */
export function pauseOf(row: { paused_until: string | null; pause_reasons: string | null }): InstancePause | undefined {
  if (!row.paused_until) return undefined;
  return {
    until: row.paused_until,
    reasons: (row.pause_reasons ?? "").split(",").filter((r) => Value.Check(PauseReason, r)),
  };
}

/** The calendar's events around now, only when a schedule pauses for news. */
async function eventsFor(news: NewsCalendar, rules: ScheduleRules[], from: Date, to: Date) {
  return rules.some((r) => r.news) ? news.events(new Date(from.getTime() - DAY_MS), to) : [];
}

/** The pauses of the next 14 days that rules make, with the calendar's events (news pauses). */
export async function upcomingPauses(
  news: NewsCalendar,
  rules: ScheduleRules,
  now = new Date(),
): Promise<PauseWindow[]> {
  const to = new Date(now.getTime() + AHEAD_MS);
  return pauseWindows([rules], await eventsFor(news, [rules], now, to), now, to);
}

/** What the schema cannot check: a known time zone, holidays that end after they start. */
export function invalidRules(rules: ScheduleRules): string | undefined {
  if (!isTimeZone(rules.timezone)) return "invalid_timezone";
  if (rules.holidays.some((h) => h.to !== undefined && h.to < h.from)) return "invalid_holiday";
  if ((rules.periods ?? []).some((p) => p.to <= p.from)) return "invalid_pause_period";
  return undefined;
}

/** The schedules (or one) with the instances that use them and their current or next pause. */
export async function listSchedules(db: Db, news: NewsCalendar, id?: number): Promise<Schedule[]> {
  let query = db
    .selectFrom("schedules")
    .leftJoin("users as creator", "creator.id", "schedules.created_by")
    .leftJoin("users as updater", "updater.id", "schedules.updated_by")
    .selectAll("schedules")
    .select(["creator.username as created_by_name", "updater.username as updated_by_name"])
    .orderBy("schedules.name");
  let links = db
    .selectFrom("instance_schedules")
    .innerJoin("instances", "instances.id", "instance_schedules.instance_id")
    .select(["instances.name", "instance_schedules.schedule_id"])
    .orderBy("instances.name");
  if (id !== undefined) {
    query = query.where("schedules.id", "=", id);
    links = links.where("instance_schedules.schedule_id", "=", id);
  }
  const [rows, linked] = await Promise.all([query.execute(), links.execute()]);
  const instancesOf = groupBy(linked, (l) => l.schedule_id);
  const parsed = rows.flatMap((row) => {
    const rules = rulesOf(row.rules);
    return rules ? [{ row, rules }] : [];
  });
  const now = new Date();
  const to = new Date(now.getTime() + AHEAD_MS);
  // One query for all of them, and none without news pauses.
  const events = await eventsFor(
    news,
    parsed.map((p) => p.rules),
    now,
    to,
  );
  return parsed.map(({ row, rules }) => {
    const [nextPause] = pauseWindows([rules], events, now, to);
    return {
      id: row.id,
      name: row.name,
      rules,
      instances: (instancesOf.get(row.id) ?? []).map((l) => l.name),
      ...(nextPause ? { nextPause } : {}),
      createdAt: row.created_at,
      ...(row.created_by_name ? { createdBy: row.created_by_name } : {}),
      updatedAt: row.updated_at,
      ...(row.updated_by_name ? { updatedBy: row.updated_by_name } : {}),
    };
  });
}

/** Another schedule already has this name. */
export async function scheduleNameTaken(db: Db, name: string, except?: number): Promise<boolean> {
  let query = db.selectFrom("schedules").select("id").where("name", "=", name);
  if (except !== undefined) query = query.where("id", "!=", except);
  return (await query.executeTakeFirst()) !== undefined;
}

/** The ids of instances by name; undefined if one of them is unknown. */
export async function instanceIds(db: Db, names: string[]): Promise<number[] | undefined> {
  const wanted = [...new Set(names)];
  if (!wanted.length) return [];
  const rows = await db.selectFrom("instances").select("id").where("name", "in", wanted).execute();
  return rows.length === wanted.length ? rows.map((r) => r.id) : undefined;
}

/**
 * Makes `ids` the schedules of an instance, or the instances of a schedule. Only the links change: the start of a
 * pause is the same whichever schedules make it up, so the scheduler sees a new pause only where one begins.
 */
export async function setLinks(
  db: Db,
  side: { instanceId: number } | { scheduleId: number },
  ids: number[],
): Promise<void> {
  const rows = ids.map((id) =>
    "instanceId" in side
      ? { instance_id: side.instanceId, schedule_id: id }
      : { instance_id: id, schedule_id: side.scheduleId },
  );
  await db.transaction().execute(async (trx) => {
    let remove = trx.deleteFrom("instance_schedules");
    remove =
      "instanceId" in side
        ? remove.where("instance_id", "=", side.instanceId)
        : remove.where("schedule_id", "=", side.scheduleId);
    if (ids.length) {
      remove = remove.where("instanceId" in side ? "schedule_id" : "instance_id", "not in", ids);
    }
    await remove.execute();
    if (rows.length)
      await trx
        .insertInto("instance_schedules")
        .values(rows)
        .onConflict((c) => c.doNothing())
        .execute();
  });
}
