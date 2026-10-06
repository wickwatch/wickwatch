import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tradingDayKey, type ChallengeProfile, type Overview, type Position } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { createAdapters } from "../src/adapters";
import { evaluateForAccount } from "../src/challenges/store";
import { loadChallengeTemplates } from "../src/challenges/templates";
import { loadConfig } from "../src/config";
import { seedDemoChallenges } from "../src/demo-seed";
import { AccountPoller } from "../src/services/poller";
import { loginAs, startApp, type TestApp } from "./helpers";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

const profile: ChallengeProfile = {
  name: "Prop A – Phase 1",
  phase: "Phase 1",
  startDate: "2026-09-01",
  startBalance: 100_000,
  rules: {
    profitTargetPct: 10,
    dailyLoss: {
      limitPct: 5,
      reference: "balance-or-equity-at-day-start",
      resetTime: "00:00",
      timezone: "Europe/Prague",
    },
    maxLoss: { limitPct: 10, type: "static" },
    minTradingDays: 4,
  },
};

describe("challenge templates", () => {
  it("loads valid files and skips examples, invalid files and unknown time zones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ww-templates-"));
    const valid = {
      id: "firm-a-phase-1",
      firm: "Firm A",
      program: "Challenge",
      phase: "Phase 1",
      name: { en: "A" },
      source: "https://example.com",
      asOf: "2026-09-01",
      ...profile.rules,
    };
    writeFileSync(join(dir, "firm-a.json"), JSON.stringify(valid));
    writeFileSync(join(dir, "_example.json"), JSON.stringify({ ...valid, id: "example" }));
    writeFileSync(join(dir, "broken.json"), JSON.stringify({ id: "Bad Id" }));
    writeFileSync(
      join(dir, "zone.json"),
      JSON.stringify({ ...valid, id: "zone", dailyLoss: { ...profile.rules.dailyLoss, timezone: "Mars/Olympus" } }),
    );
    writeFileSync(join(dir, "garbage.json"), "{");
    const templates = await loadChallengeTemplates(dir, log);
    expect(templates.map((t) => t.id)).toEqual(["firm-a-phase-1"]);
  });

  it("loads every template in the repo without warnings", async () => {
    const dir = loadConfig({}, join(__dirname, "../../..")).challengeTemplatesDir;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
    const repoLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const templates = await loadChallengeTemplates(dir, repoLog as never);
    expect(repoLog.warn).not.toHaveBeenCalled();
    expect(templates.map((t) => `${t.id}.json`).sort()).toEqual(files.sort());
  });
});

describe("challenge profile API", () => {
  let t: TestApp;
  let admin: string;
  beforeEach(async () => {
    t = await startApp();
    admin = await loginAs(t, "admin");
  });
  afterEach(async () => {
    await t.app.close();
  });
  const call = (method: "GET" | "PUT" | "DELETE", number: string, payload?: object, cookie = admin) =>
    t.app.inject({
      method,
      url: `/api/v1/accounts/${number}/challenge`,
      headers: { cookie },
      ...(payload ? { payload } : {}),
    });

  it("saves, reads and deletes a profile and audits it", async () => {
    expect((await call("GET", "1111111")).statusCode).toBe(404);
    expect((await call("PUT", "1111111", profile)).statusCode).toBe(200);
    expect((await call("GET", "1111111")).json()).toEqual(profile);
    const accounts = await t.app.inject({ url: "/api/v1/accounts", headers: { cookie: admin } });
    const account = accounts.json<{ number: string; accountSize?: unknown }[]>().find((a) => a.number === "1111111");
    expect(account?.accountSize).toEqual({ value: profile.startBalance, basis: "challengeStart" });
    expect((await call("PUT", "1111111", { ...profile, name: "Renamed" })).json()).toMatchObject({ name: "Renamed" });
    expect((await call("DELETE", "1111111")).statusCode).toBe(204);
    expect((await call("GET", "1111111")).statusCode).toBe(404);
    const actions = await t.db
      .selectFrom("audit_log")
      .select("action")
      .where("action", "like", "challenge.%")
      .execute();
    expect(actions.map((a) => a.action)).toEqual(["challenge.save", "challenge.save", "challenge.delete"]);
  });

  it("validates time zone, template and account", async () => {
    const badZone = {
      ...profile,
      rules: { ...profile.rules, dailyLoss: { ...profile.rules.dailyLoss!, timezone: "Mars/Olympus" } },
    };
    expect((await call("PUT", "1111111", badZone)).json()).toEqual({ error: "invalid_timezone" });
    expect((await call("PUT", "1111111", { ...profile, templateId: "nope" })).json()).toEqual({
      error: "template_not_found",
    });
    expect((await call("PUT", "999", profile)).statusCode).toBe(404);
    expect((await call("PUT", "1111111", { ...profile, startBalance: -1 })).statusCode).toBe(400);
  });

  it("lets viewers read but not change profiles", async () => {
    await call("PUT", "1111111", profile);
    const viewer = await loginAs(t, "viewer");
    expect((await call("GET", "1111111", undefined, viewer)).statusCode).toBe(200);
    expect((await call("PUT", "1111111", profile, viewer)).statusCode).toBe(403);
    expect((await call("DELETE", "1111111", undefined, viewer)).statusCode).toBe(403);
  });

  it("shows the evaluation in the overview", async () => {
    // Today in the profile's zone (Prague), not the UTC date: they differ around midnight.
    await call("PUT", "1111111", { ...profile, startDate: tradingDayKey(new Date(), "00:00", "Europe/Prague") });
    const overview = (await t.app.inject({ url: "/api/v1/overview", headers: { cookie: admin } })).json<Overview>();
    const challenge = overview.accounts.find((a) => a.number === "1111111")?.challenge;
    expect(challenge).toMatchObject({ name: "Prop A – Phase 1", day: 1 });
    expect(challenge?.rules.map((r) => r.id)).toEqual(["profitTarget", "dailyLoss", "maxLoss", "tradingDays"]);
    expect(overview.accounts.find((a) => a.number === "3333333")).not.toHaveProperty("challenge");
  });

  it("raises an alert when a limit is breached", async () => {
    // A start balance far above the demo balance makes the max loss rule fail.
    await call("PUT", "1111111", { ...profile, startBalance: 200_000 });
    const overview = (await t.app.inject({ url: "/api/v1/overview", headers: { cookie: admin } })).json<Overview>();
    expect(overview.alerts).toContainEqual({
      level: "error",
      code: "challenge_breached",
      subject: "1111111",
      params: { rule: "maxLoss" },
    });
  });
});

describe("account poller", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.app.close();
  });

  it("records day start, minimum and maximum equity and marks trading days", async () => {
    t = await startApp();
    await seedDemoChallenges(t.db);
    const config = loadConfig({ DATABASE_URL: "file::memory:" });
    const adapters = createAdapters(config);
    let now = new Date("2026-09-25T08:00:00Z");
    const poller = new AccountPoller({
      db: t.db,
      adapters,
      accounts: dbAccountDirectory(t.db, t.cipher, "demo"),
      log,
      now: () => now,
    });

    await poller.pollStats();
    now = new Date("2026-09-25T09:00:00Z");
    await poller.pollStats();
    await poller.pollDeals();

    const rows = await t.db
      .selectFrom("daily_stats")
      .selectAll()
      .where("day", "=", "2026-09-25")
      .orderBy("account_id")
      .execute();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.first_sample_at).toBe("2026-09-25T08:00:00.000Z");
      expect(row.last_sample_at).toBe("2026-09-25T09:00:00.000Z");
      expect(row.min_equity).toBeLessThanOrEqual(row.max_equity!);
      expect(row.start_equity).not.toBeNull();
    }
    const traded = await t.db.selectFrom("daily_stats").select("day").where("traded", "=", 1).execute();
    expect(traded.length).toBeGreaterThan(0);
  });
});

describe("challenge evaluation from the recorded days", () => {
  it("trails end-of-day max loss on the best earlier day-start balance and flags late samples", async () => {
    const t = await startApp();
    try {
      await seedDemoChallenges(t.db);
      const { id } = await t.db.selectFrom("accounts").select("id").orderBy("id").executeTakeFirstOrThrow();
      const eod: ChallengeProfile = {
        name: "EOD",
        startDate: "2026-09-21",
        startBalance: 100_000,
        rules: {
          dailyLoss: {
            limitPct: 5,
            reference: "balance-at-day-start",
            resetTime: "16:15",
            timezone: "America/Chicago",
          },
          maxLoss: { limitPct: 10, type: "trailing-eod-balance" },
        },
      };
      const row = (day: string, start_balance: number, first_sample_at: string) => ({
        account_id: id,
        day,
        start_balance,
        start_equity: start_balance,
        min_equity: start_balance,
        max_equity: start_balance + 5_000,
        first_sample_at,
        last_sample_at: first_sample_at,
      });
      await t.db.deleteFrom("daily_stats").where("account_id", "=", id).execute();
      await t.db
        .insertInto("daily_stats")
        .values([
          // Day 2026-09-22 starts at 21:15 UTC; sampled a minute later.
          row("2026-09-22", 106_000, "2026-09-22T21:16:00.000Z"),
          row("2026-09-23", 104_000, "2026-09-23T21:16:00.000Z"),
        ])
        .execute();
      const now = new Date("2026-09-25T15:00:00Z");
      const state = { balance: 103_000, equity: 101_000, deals: [] };

      const onTime = await evaluateForAccount(t.db, id, eod, state, now);
      // Limit from 106,000 (not from the intraday equity peak 111,000): 5,000 below is 5 %.
      expect(onTime.rules.find((r) => r.id === "maxLoss")).toMatchObject({ value: 5, status: "warning" });
      expect(onTime.rules.find((r) => r.id === "maxLoss")?.approximate).toBeUndefined();

      await t.db
        .insertInto("daily_stats")
        .values(row("2026-09-21", 100_000, "2026-09-22T02:00:00.000Z"))
        .execute();
      const late = await evaluateForAccount(t.db, id, eod, state, now);
      expect(late.rules.find((r) => r.id === "maxLoss")).toMatchObject({ value: 5, approximate: true });
    } finally {
      await t.app.close();
    }
  });
});

describe("inactivity from the recorded trading days", () => {
  it("counts the days since the last day a position was opened, and today's trade at once", async () => {
    const t = await startApp();
    try {
      await seedDemoChallenges(t.db);
      const { id } = await t.db.selectFrom("accounts").select("id").orderBy("id").executeTakeFirstOrThrow();
      const inactive: ChallengeProfile = {
        name: "Funded",
        startDate: "2026-09-01",
        startBalance: 100_000,
        rules: { maxInactiveDays: 21 },
      };
      await t.db.deleteFrom("daily_stats").where("account_id", "=", id).execute();
      await t.db
        .insertInto("daily_stats")
        .values([
          { account_id: id, day: "2026-09-03", traded: 1 },
          { account_id: id, day: "2026-09-08", traded: 1 },
          // Sampled, but no position opened.
          { account_id: id, day: "2026-09-20", traded: 0 },
        ])
        .execute();
      await t.db
        .updateTable("challenge_profiles")
        .set({ trading_days_from: "2026-09-01" })
        .where("account_id", "=", id)
        .execute();
      const now = new Date("2026-09-25T10:00:00Z");
      const rule = async (positions: Position[] = []) =>
        (
          await evaluateForAccount(t.db, id, inactive, { balance: 100_000, equity: 100_000, deals: [], positions }, now)
        ).rules.find((r) => r.id === "inactivity");

      expect(await rule()).toMatchObject({ status: "danger", value: 17, limit: 21 });
      expect((await rule())?.pending).toBeUndefined();
      // A position opened today ends the count before the poller marks the day.
      const opened: Position = {
        id: "p1",
        symbol: "GER40",
        side: "buy",
        volume: 1,
        entry: 19_400,
        pnl: 0,
        openedAt: "2026-09-25T09:00:00.000Z",
      };
      expect(await rule([opened])).toMatchObject({ status: "ok", value: 0 });
    } finally {
      await t.app.close();
    }
  });
});

describe("trading days of a new profile", () => {
  it("are marked right after saving and shown as loading until then", async () => {
    const saved: number[] = [];
    const t = await startApp({}, { onChallengeSaved: (id) => saved.push(id) });
    try {
      const admin = await loginAs(t, "admin");
      const put = (body: ChallengeProfile) =>
        t.app.inject({
          method: "PUT",
          url: "/api/v1/accounts/1111111/challenge",
          headers: { cookie: admin, "x-requested-with": "wickwatch" },
          payload: body,
        });
      expect((await put(profile)).statusCode).toBe(200);
      const { id } = await t.db
        .selectFrom("accounts")
        .select("id")
        .where("number", "=", "1111111")
        .executeTakeFirstOrThrow();
      expect(saved).toEqual([id]);

      const now = new Date("2026-09-25T10:00:00Z");
      const state = { balance: 100_000, equity: 100_000, deals: [] };
      const days = async () =>
        (await evaluateForAccount(t.db, id, profile, state, now)).rules.find((r) => r.id === "tradingDays");
      expect(await days()).toMatchObject({ pending: true });

      const config = loadConfig({ DATABASE_URL: "file::memory:" });
      const poller = new AccountPoller({
        db: t.db,
        adapters: createAdapters(config),
        accounts: dbAccountDirectory(t.db, t.cipher, "demo"),
        log,
        now: () => now,
      });
      await poller.syncTradingDays(id);
      expect((await days())?.pending).toBeUndefined();

      // An earlier start date needs the older days first.
      const earlier = { ...profile, startDate: "2026-08-01" };
      expect((await put(earlier)).statusCode).toBe(200);
      const evaluation = await evaluateForAccount(t.db, id, earlier, state, now);
      expect(evaluation.rules.find((r) => r.id === "tradingDays")).toMatchObject({ pending: true });
    } finally {
      await t.app.close();
    }
  });
});

describe("trading days by opening day", () => {
  it("marks the day a position opened and clears days marked by closing day before", async () => {
    const t = await startApp();
    try {
      await seedDemoChallenges(t.db);
      const config = loadConfig({ DATABASE_URL: "file::memory:" });
      const demo = createAdapters(config);
      const deal = { id: "1", positionId: "1", symbol: "US100", side: "buy" as const, volume: 1, price: 1, pnl: 10 };
      const adapters = {
        ...demo,
        broker: Object.assign(Object.create(demo.broker) as typeof demo.broker, {
          // Opened Monday, closed Tuesday.
          deals: async () => [{ ...deal, time: "2026-09-22T07:00:00.000Z", openedAt: "2026-09-21T19:00:00.000Z" }],
          positions: async () => [],
        }),
      };
      const { id } = await t.db
        .selectFrom("accounts")
        .select("id")
        .where("number", "=", "1111111")
        .executeTakeFirstOrThrow();
      await t.db
        .updateTable("challenge_profiles")
        .set({ profile: JSON.stringify(profile) })
        .where("account_id", "=", id)
        .execute();
      await t.db.deleteFrom("daily_stats").where("account_id", "=", id).execute();
      // Marked by an older version on the closing day.
      await t.db.insertInto("daily_stats").values({ account_id: id, day: "2026-09-22", traded: 1 }).execute();
      const poller = new AccountPoller({
        db: t.db,
        adapters,
        accounts: dbAccountDirectory(t.db, t.cipher, "demo"),
        log,
        now: () => new Date("2026-09-25T10:00:00Z"),
      });
      await poller.syncTradingDays(id);
      const traded = await t.db
        .selectFrom("daily_stats")
        .select("day")
        .where("account_id", "=", id)
        .where("traded", "=", 1)
        .execute();
      expect(traded.map((r) => r.day)).toEqual(["2026-09-21"]);
    } finally {
      await t.app.close();
    }
  });
});
