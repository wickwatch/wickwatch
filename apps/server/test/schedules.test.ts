import type { RuntimeAdapter, RuntimeInstance, ScheduleRules } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { endPause, InstanceKeeper, setShouldRun, stopAccount } from "../src/services/instance-keeper";
import { NewsCalendar, parseCalendar } from "../src/services/news-calendar";
import { Scheduler } from "../src/services/scheduler";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let status: RuntimeInstance["status"];
let calls: string[];
let now: Date;

const runtime = {
  list: async () => [{ ref: "bot-a", labels: {}, status, restartCount: 0 }],
  start: async (ref: string) => {
    calls.push(`start ${ref}`);
    status = "running";
  },
  stop: async (ref: string) => {
    calls.push(`stop ${ref}`);
    status = "stopped";
  },
} as unknown as RuntimeAdapter;

// Fri 21:00 to Sun 23:00, Berlin.
const weekend: ScheduleRules = {
  timezone: "Europe/Berlin",
  weekend: { from: { day: 5, time: "21:00" }, to: { day: 0, time: "23:00" } },
  holidays: [],
};
const inject = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, cookie = admin) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });
const row = () =>
  t.db
    .selectFrom("instances")
    .select(["should_run", "stopped_by_user", "paused_until", "pause_reasons", "schedule_window"])
    .where("name", "=", "bot-a")
    .executeTakeFirstOrThrow();
const scheduleIdsOf = async (name: string) =>
  (
    await t.db
      .selectFrom("instance_schedules")
      .innerJoin("instances", "instances.id", "instance_schedules.instance_id")
      .select("instance_schedules.schedule_id")
      .where("instances.name", "=", name)
      .orderBy("instance_schedules.schedule_id")
      .execute()
  ).map((r) => r.schedule_id);
const audits = async () =>
  (await t.db.selectFrom("audit_log").select("action").where("action", "like", "instance.schedule%").execute()).map(
    (r) => r.action,
  );

beforeEach(async () => {
  t = await startApp();
  admin = await loginAs(t, "admin");
  const account = await t.db.selectFrom("accounts").select("id").executeTakeFirstOrThrow();
  await t.db
    .insertInto("instances")
    .values({ name: "bot-a", account_id: account.id, created_by: null, created_at: "2026-09-30T00:00:00.000Z" })
    .execute();
  status = "running";
  calls = [];
  now = new Date("2026-10-23T18:00:00Z");
});
afterEach(async () => {
  await t.app.close();
});

async function withSchedule(rules = weekend) {
  const created = await inject("POST", "/schedules", { name: "Weekend", rules });
  const { id } = created.json<{ id: number }>();
  expect((await inject("PUT", "/managed-instances/bot-a/schedules", { scheduleIds: [id] })).statusCode).toBe(204);
  return id;
}
const scheduler = (news = new NewsCalendar({ db: t.db, log: t.app.log, url: undefined })) =>
  new Scheduler({ db: t.db, runtime, news, log: t.app.log, now: () => now });

describe("schedules API", () => {
  it("creates, lists, changes and deletes schedules, audited, with their instances and next pause", async () => {
    const id = await withSchedule();
    const [listed] = (await inject("GET", "/schedules", undefined, await loginAs(t, "viewer"))).json<
      { name: string; instances: string[]; nextPause?: { reasons: string[] } }[]
    >();
    expect(listed).toMatchObject({ name: "Weekend", instances: ["bot-a"], nextPause: { reasons: ["weekend"] } });
    expect(await scheduleIdsOf("bot-a")).toEqual([id]);

    expect((await inject("PUT", `/schedules/${String(id)}`, { name: "Week end", rules: weekend })).statusCode).toBe(
      200,
    );
    expect((await inject("DELETE", `/schedules/${String(id)}`)).statusCode).toBe(204);
    expect((await inject("GET", "/schedules")).json()).toEqual([]);
    expect((await row()).schedule_window).toBeNull();
    const actions = await t.db
      .selectFrom("audit_log")
      .select(["action", "user_id"])
      .where("action", "like", "%schedule%")
      .execute();
    expect(actions.map((a) => a.action)).toEqual([
      "schedule.create",
      "instance.schedule",
      "schedule.update",
      "schedule.delete",
    ]);
    expect(actions.every((a) => a.user_id !== null)).toBe(true);
  });

  it("takes the instances it pauses when it is created or changed, and keeps them when left out", async () => {
    const created = await inject("POST", "/schedules", { name: "Weekend", rules: weekend, instances: ["bot-a"] });
    const { id, instances } = created.json<{ id: number; instances: string[] }>();
    expect(instances).toEqual(["bot-a"]);
    expect(await scheduleIdsOf("bot-a")).toEqual([id]);
    await inject("PUT", `/schedules/${String(id)}`, { name: "Weekend", rules: weekend });
    expect(await scheduleIdsOf("bot-a")).toEqual([id]);
    await inject("PUT", `/schedules/${String(id)}`, { name: "Weekend", rules: weekend, instances: [] });
    expect(await scheduleIdsOf("bot-a")).toEqual([]);
    const unknown = await inject("POST", "/schedules", { name: "B", rules: weekend, instances: ["nope"] });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "instance_not_found" });
    expect((await inject("GET", "/schedules/instances")).json()).toEqual(["bot-a"]);
  });

  it("refuses unknown time zones, holidays ending before they start, taken names and viewers", async () => {
    expect(
      (await inject("POST", "/schedules", { name: "A", rules: { ...weekend, timezone: "Mars/Base" } })).json(),
    ).toEqual({
      error: "invalid_timezone",
    });
    const holidays = [{ from: "2026-12-26", to: "2026-12-24" }];
    expect((await inject("POST", "/schedules", { name: "A", rules: { ...weekend, holidays } })).json()).toEqual({
      error: "invalid_holiday",
    });
    const periods = [{ from: "2026-10-30T22:00", to: "2026-10-30T21:00" }];
    expect((await inject("POST", "/schedules", { name: "A", rules: { ...weekend, periods } })).json()).toEqual({
      error: "invalid_pause_period",
    });
    await inject("POST", "/schedules", { name: "A", rules: weekend });
    expect((await inject("POST", "/schedules", { name: "A", rules: weekend })).statusCode).toBe(409);
    const viewer = await loginAs(t, "viewer");
    expect((await inject("POST", "/schedules", { name: "B", rules: weekend }, viewer)).statusCode).toBe(403);
    expect((await inject("PUT", "/managed-instances/bot-a/schedules", { scheduleIds: [] }, viewer)).statusCode).toBe(
      403,
    );
    expect((await inject("PUT", "/managed-instances/bot-a/schedules", { scheduleIds: [999] })).json()).toEqual({
      error: "schedule_not_found",
    });
  });

  it("previews the pauses of rules before they are saved", async () => {
    const res = await inject("POST", "/schedules/preview", { rules: weekend });
    const windows = res.json<{ reasons: string[] }[]>();
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows.every((w) => w.reasons.includes("weekend"))).toBe(true);
  });
});

describe("scheduler", () => {
  it("pauses a running instance when a pause begins, without alert, and starts it again when it ends", async () => {
    await withSchedule();
    await scheduler().check();
    expect(calls).toEqual([]);

    now = new Date("2026-10-23T19:00:00Z");
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a"]);
    expect(await row()).toMatchObject({
      should_run: 0,
      stopped_by_user: 1,
      paused_until: "2026-10-25T22:00:00.000Z",
      pause_reasons: "weekend",
    });
    // Once per pause.
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a"]);

    now = new Date("2026-10-25T22:00:00Z");
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a", "start bot-a"]);
    expect(await row()).toMatchObject({ should_run: 1, stopped_by_user: 0, paused_until: null, schedule_window: null });
    expect(await audits()).toEqual(["instance.schedule", "instance.schedule_pause", "instance.schedule_resume"]);
  });

  it("leaves an instance as the user left it during a pause", async () => {
    await withSchedule();
    now = new Date("2026-10-24T10:00:00Z");
    await scheduler().check();
    // Started by hand during the pause (as the route does): it runs on, and is not stopped again in this pause.
    await endPause(t.db, "bot-a");
    await setShouldRun(t.db, "bot-a", true);
    status = "running";
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a"]);
    now = new Date("2026-10-26T08:00:00Z");
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a"]);

    // Stopped by hand before a pause ends: not started.
    now = new Date("2026-10-31T10:00:00Z");
    await scheduler().check();
    await endPause(t.db, "bot-a");
    await setShouldRun(t.db, "bot-a", false, true);
    now = new Date("2026-11-02T08:00:00Z");
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a", "stop bot-a"]);
  });

  it("pauses an instance while any of its schedules pauses, as one pause", async () => {
    const first = (await inject("POST", "/schedules", { name: "Weekend", rules: weekend })).json<{ id: number }>().id;
    const holiday = { timezone: "Europe/Berlin", holidays: [{ from: "2026-10-24", name: "Saturday off" }] };
    const second = (await inject("POST", "/schedules", { name: "Holiday", rules: holiday })).json<{ id: number }>().id;
    await inject("PUT", "/managed-instances/bot-a/schedules", { scheduleIds: [first, second] });
    expect(await scheduleIdsOf("bot-a")).toEqual([first, second]);

    now = new Date("2026-10-24T10:00:00Z");
    await scheduler().check();
    // Both pause now: one pause from the weekend's start to its end, with both reasons.
    expect(calls).toEqual(["stop bot-a"]);
    expect(await row()).toMatchObject({
      schedule_window: "2026-10-23T19:00:00.000Z",
      paused_until: "2026-10-25T22:00:00.000Z",
      pause_reasons: "weekend,holiday",
    });
    now = new Date("2026-10-25T22:00:00Z");
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a", "start bot-a"]);
  });

  it("does not stop an instance started by hand again when news run the weekend on", async () => {
    const news = new NewsCalendar({ db: t.db, log: t.app.log, url: undefined });
    await t.db
      .insertInto("news_events")
      .values({ time: "2026-10-25T22:15:00Z", currency: "USD", impact: "high", title: "Speech" })
      .execute();
    await withSchedule({ ...weekend, news: { currencies: ["USD"], impact: "high", before: 30, after: 30 } });
    now = new Date("2026-10-24T10:00:00Z");
    await scheduler(news).check();
    await endPause(t.db, "bot-a");
    await setShouldRun(t.db, "bot-a", true);
    status = "running";
    // The weekend is over, the news still pause: the same pause, which the user already ended for this instance.
    now = new Date("2026-10-25T22:30:00Z");
    await scheduler(news).check();
    expect(calls).toEqual(["stop bot-a"]);
  });

  it("does not start an instance again that the emergency stop or the loss guard stopped during the pause", async () => {
    await withSchedule();
    now = new Date("2026-10-24T10:00:00Z");
    await scheduler().check();
    const account = await t.db.selectFrom("accounts").select("id").executeTakeFirstOrThrow();
    const entry = (await dbAccountDirectory(t.db, t.cipher, "demo").list()).find((e) => e.id === account.id);
    if (!entry) throw new Error("no account");
    await stopAccount(t.db, entry, {
      runtime: t.adapters.runtime,
      broker: t.adapters.broker,
      labelPrefix: "wickwatch",
    });
    now = new Date("2026-10-26T08:00:00Z");
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a"]);
    expect(await row()).toMatchObject({ should_run: 0, stopped_by_user: 1, paused_until: null });
  });

  it("is not undone by the instance keeper taking over running instances at a start", async () => {
    await withSchedule();
    now = new Date("2026-10-24T10:00:00Z");
    // The keeper's list was taken before the scheduler's stop went through.
    const running = { list: async () => [{ ref: "bot-a", labels: {}, status: "running", restartCount: 0 }] };
    await scheduler().check();
    await new InstanceKeeper({ db: t.db, runtime: running as unknown as RuntimeAdapter, log: t.app.log }).check();
    expect(await row()).toMatchObject({ should_run: 0, paused_until: "2026-10-25T22:00:00.000Z" });
  });

  it("does not stop an instance that is not running, and starts what it paused when the schedule goes", async () => {
    status = "stopped";
    await withSchedule();
    now = new Date("2026-10-24T10:00:00Z");
    await scheduler().check();
    expect(calls).toEqual([]);

    status = "running";
    await t.db.updateTable("instances").set({ schedule_window: null }).execute();
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a"]);
    await inject("PUT", "/managed-instances/bot-a/schedules", { scheduleIds: [] });
    await scheduler().check();
    expect(calls).toEqual(["stop bot-a", "start bot-a"]);
  });

  it("pauses around news from the calendar, fetched only while a schedule needs it", async () => {
    const feed = vi.fn(async () =>
      Response.json([
        { title: "Non-Farm Employment Change", country: "USD", date: "2026-10-09T08:30:00-04:00", impact: "High" },
        { title: "Bank Holiday", country: "GBP", date: "2026-10-09T00:00:00-04:00", impact: "Holiday" },
      ]),
    );
    const news = new NewsCalendar({
      db: t.db,
      log: t.app.log,
      url: new URL("https://calendar.example/week.json"),
      fetch: feed,
      now: () => now.getTime(),
    });
    now = new Date("2026-10-09T12:00:00Z");
    await scheduler(news).check();
    expect(feed).not.toHaveBeenCalled();

    await withSchedule({ ...weekend, news: { currencies: ["USD"], impact: "high", before: 15, after: 15 } });
    await scheduler(news).check();
    expect(feed).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    now = new Date("2026-10-09T12:20:00Z");
    await scheduler(news).check();
    expect(calls).toEqual(["stop bot-a"]);
    expect(await row()).toMatchObject({ paused_until: "2026-10-09T12:45:00.000Z", pause_reasons: "news" });
    // Hourly, not on every check.
    expect(feed).toHaveBeenCalledTimes(1);
  });
});

describe("paused instances", () => {
  it("show their pause in the overview and the instance detail while they are not up", async () => {
    const account = await t.db
      .selectFrom("accounts")
      .select("id")
      .where("number", "=", "1111111")
      .executeTakeFirstOrThrow();
    const paused = { paused_until: "2026-10-25T22:00:00.000Z", pause_reasons: "weekend,news" };
    for (const name of ["beta-us500-own", "alpha-ger40-a"]) {
      await t.db
        .insertInto("instances")
        .values({ name, account_id: account.id, created_by: null, created_at: "2026-09-30T00:00:00.000Z", ...paused })
        .execute();
    }
    const pause = { until: "2026-10-25T22:00:00.000Z", reasons: ["weekend", "news"] };
    const overview = (await inject("GET", "/overview")).json<{ instances: { ref: string; paused?: unknown }[] }>();
    expect(overview.instances.find((i) => i.ref === "beta-us500-own")?.paused).toEqual(pause);
    // Started by hand meanwhile: it just runs.
    expect(overview.instances.find((i) => i.ref === "alpha-ger40-a")?.paused).toBeUndefined();
    const detail = (await inject("GET", "/instances/beta-us500-own")).json<{ instance: { paused?: unknown } }>();
    expect(detail.instance.paused).toEqual(pause);
  });
});

describe("parseCalendar", () => {
  it("takes events with a currency, a time and a known impact", () => {
    expect(
      parseCalendar([
        { title: "CPI m/m", country: "EUR", date: "2026-10-01T05:00:00-04:00", impact: "Medium" },
        { title: "Holiday", country: "JPY", date: "2026-10-01T00:00:00-04:00", impact: "Holiday" },
        { title: "Speech", country: "All", date: "2026-10-01T05:00:00-04:00", impact: "High" },
        { title: "Bad", country: "USD", date: "soon", impact: "High" },
        "nonsense",
      ]),
    ).toEqual([{ time: "2026-10-01T09:00:00.000Z", currency: "EUR", impact: "medium", title: "CPI m/m" }]);
    expect(parseCalendar({ not: "a list" })).toEqual([]);
  });
});
