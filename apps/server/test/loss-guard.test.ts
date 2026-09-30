import { readLabels, type ChallengeProfile } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { createAdapters, type Adapters } from "../src/adapters";
import { loadConfig } from "../src/config";
import { LogTracker } from "../src/services/log-tracker";
import { LossGuardService } from "../src/services/loss-guard";
import { OverviewLoader } from "../src/services/overview";
import { startApp, type TestApp } from "./helpers";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const NOW = new Date("2026-09-25T12:00:00Z");

let t: TestApp;
let adapters: Adapters;

/** Demo account 1111111 with a profile whose max loss is far used up: the start balance is set above the balance. */
async function withProfile(guard: ChallengeProfile["guard"]) {
  const account = await t.db
    .selectFrom("accounts")
    .select("id")
    .where("number", "=", "1111111")
    .executeTakeFirstOrThrow();
  const { balance } = await adapters.broker.stats({ login: "demo", secret: "demo" }, "1111111");
  const profile: ChallengeProfile = {
    name: "Guarded",
    startDate: "2026-09-01",
    startBalance: Math.round(balance * 1.2),
    rules: { maxLoss: { limitPct: 20, type: "static" } },
    ...(guard ? { guard } : {}),
  };
  await t.db
    .insertInto("challenge_profiles")
    .values({
      account_id: account.id,
      template_id: null,
      profile: JSON.stringify(profile),
      created_at: "",
      updated_at: "",
    })
    .execute();
}

const guardService = () =>
  new LossGuardService({
    db: t.db,
    adapters,
    accounts: dbAccountDirectory(t.db, t.cipher, "demo"),
    labelPrefix: "wickwatch",
    log,
    now: () => NOW,
  });

const running = async () =>
  (await adapters.runtime.list())
    .filter((i) => readLabels("wickwatch", i.labels).account === "1111111" && i.status === "running")
    .map((i) => i.ref);

beforeEach(async () => {
  t = await startApp();
  adapters = createAdapters(loadConfig({ DATABASE_URL: "file::memory:" }));
});
afterEach(async () => {
  await t.app.close();
});

describe("loss guard", () => {
  it("does nothing without a guard in the profile", async () => {
    await withProfile(undefined);
    const before = await running();
    await guardService().check();
    expect(await running()).toEqual(before);
    expect(await t.db.selectFrom("guard_trips").selectAll().execute()).toEqual([]);
  });

  it("runs the emergency stop once the limit is used up to the guard's share, once per trading day", async () => {
    await withProfile({ usagePct: 80 });
    expect((await running()).length).toBeGreaterThan(0);
    const guard = guardService();
    await guard.check();

    expect(await running()).toEqual([]);
    expect(await adapters.broker.positions({ login: "demo", secret: "demo" }, "1111111")).toEqual([]);
    const [trip] = await t.db.selectFrom("guard_trips").selectAll().execute();
    expect(trip).toMatchObject({ day: "2026-09-25", rule: "maxLoss", ok: 1 });
    const audit = await t.db.selectFrom("audit_log").selectAll().where("action", "=", "account.loss_guard").execute();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.details!)).toMatchObject({ ok: true, rule: "maxLoss", threshold: 80 });

    // Started again by hand the same day: left alone.
    const [ref] = (await adapters.runtime.list()).filter(
      (i) => readLabels("wickwatch", i.labels).account === "1111111",
    );
    await adapters.runtime.start(ref!.ref);
    await guard.check();
    expect(await running()).toEqual([ref!.ref]);

    const overview = await new OverviewLoader({
      adapters,
      directory: dbAccountDirectory(t.db, t.cipher, "demo"),
      db: t.db,
      labelPrefix: "wickwatch",
      logTracker: new LogTracker(adapters.runtime),
      log: () => log,
    }).overview(NOW);
    expect(overview.alerts).toContainEqual({
      level: "error",
      code: "challenge_guard",
      subject: "1111111",
      params: { rule: "maxLoss", since: NOW.toISOString() },
    });
  });

  it("keeps its hands off while the limit is used less than the guard's share", async () => {
    await withProfile({ usagePct: 100 });
    // 16.7 % of 20 % = 83 %: a warning, but below the guard at 100 %.
    const before = await running();
    await guardService().check();
    expect(await running()).toEqual(before);
  });
});
