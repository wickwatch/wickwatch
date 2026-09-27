import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChallengeProfile, Overview } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { createAdapters } from "../src/adapters";
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

  it("has no templates for the example-only directory in the repo", async () => {
    expect(
      await loadChallengeTemplates(loadConfig({}, join(__dirname, "../../..")).challengeTemplatesDir, log),
    ).toEqual([]);
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
    await call("PUT", "1111111", { ...profile, startDate: new Date().toISOString().slice(0, 10) });
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
