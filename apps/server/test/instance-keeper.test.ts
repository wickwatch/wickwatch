import type { LogLine, RuntimeAdapter, RuntimeInstance } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InstanceKeeper } from "../src/services/instance-keeper";
import { withLogEvents } from "../src/services/log-tracker";
import { startApp, type TestApp } from "./helpers";

let t: TestApp;
let instances: RuntimeInstance[];
let logs: Record<string, string[]>;
let started: string[];
let listFails: boolean;
let now: number;

const plainRuntime = {
  list: async () => {
    if (listFails) throw new Error("docker down");
    return instances;
  },
  async *logs(ref: string): AsyncIterable<LogLine> {
    for (const text of logs[ref] ?? []) yield { time: "2026-09-30T09:30:00.000Z", text };
  },
  start: async (ref: string) => {
    started.push(ref);
  },
} as unknown as RuntimeAdapter;
// As createAdapters hands it out: with the broker's log events.
const runtime = withLogEvents(plainRuntime, {
  logEvent: (text) => (text === "cBot stopped itself" ? "algo_stopped" : undefined),
});

const bot = (status: RuntimeInstance["status"], exitCode?: number): RuntimeInstance => ({
  ref: "bot-a",
  labels: {},
  status,
  restartCount: 0,
  ...(exitCode !== undefined ? { exitCode } : {}),
});
const shouldRun = async () =>
  (await t.db.selectFrom("instances").select("should_run").where("name", "=", "bot-a").executeTakeFirstOrThrow())
    .should_run;
const audits = async () =>
  (await t.db.selectFrom("audit_log").select(["action", "target"]).where("action", "like", "instance.%").execute()).map(
    (r) => `${r.action} ${r.target}`,
  );

beforeEach(async () => {
  t = await startApp();
  const account = await t.db.selectFrom("accounts").select("id").executeTakeFirstOrThrow();
  await t.db
    .insertInto("instances")
    .values({ name: "bot-a", account_id: account.id, created_by: null, created_at: "2026-09-30T00:00:00.000Z" })
    .execute();
  instances = [];
  logs = {};
  started = [];
  listFails = false;
  now = Date.parse("2026-09-30T10:00:00.000Z");
});
afterEach(async () => {
  await t.app.close();
});

const keeper = () => new InstanceKeeper({ db: t.db, runtime, log: t.app.log, now: () => now });

describe("instance keeper", () => {
  it("takes over a running instance as meant to run", async () => {
    instances = [bot("running")];
    await keeper().check();
    expect(await shouldRun()).toBe(1);
    expect(started).toEqual([]);
  });

  it("does not take an instance over again while wickwatch stops it", async () => {
    await t.db.updateTable("instances").set({ should_run: 1 }).execute();
    const k = keeper();
    instances = [bot("running")];
    await k.check();
    // A stop (here the loss guard) clears "should run" first; the container is still up during the next check.
    await t.db.updateTable("instances").set({ should_run: 0 }).execute();
    await k.check();
    expect(await shouldRun()).toBe(0);
    instances = [bot("stopped", 0)];
    await k.check();
    expect(started).toEqual([]);
  });

  it("starts an instance again that a restart ended cleanly, and audits it", async () => {
    const k = keeper();
    instances = [bot("running")];
    await k.check();
    // Docker restarted: SIGTERM, "stopped by user", exit 0.
    instances = [bot("stopped", 0)];
    logs = { "bot-a": ["Info | CBot instance [probe, EURUSD, m1] stopped by user."] };
    await k.check();
    expect(started).toEqual(["bot-a"]);
    expect(await audits()).toContain("instance.autostart bot-a");
  });

  it("leaves an instance stopped that stopped itself, and forgets that it should run", async () => {
    await t.db.updateTable("instances").set({ should_run: 1 }).execute();
    instances = [bot("stopped", 0)];
    logs = { "bot-a": ["Info | CBot instance [probe, EURUSD, m1] stopped.", "cBot stopped itself"] };
    await keeper().check();
    expect(started).toEqual([]);
    expect(await shouldRun()).toBe(0);
  });

  it("leaves crashes, never-started instances and ones not meant to run alone", async () => {
    await t.db.updateTable("instances").set({ should_run: 1 }).execute();
    for (const instance of [bot("error", 1), bot("stopped")]) {
      instances = [instance];
      await keeper().check();
    }
    await t.db.updateTable("instances").set({ should_run: 0 }).execute();
    instances = [bot("stopped", 0)];
    await keeper().check();
    expect(started).toEqual([]);
  });

  it("gives up when an instance ends again right after an automatic start", async () => {
    await t.db.updateTable("instances").set({ should_run: 1 }).execute();
    const k = keeper();
    instances = [bot("stopped", 0)];
    await k.check();
    now += 60_000;
    await k.check();
    expect(started).toEqual(["bot-a"]);
    expect(await shouldRun()).toBe(0);
    expect(await audits()).toContain("instance.autostart_gave_up bot-a");
  });

  it("does nothing while the runtime cannot be reached", async () => {
    await t.db.updateTable("instances").set({ should_run: 1 }).execute();
    listFails = true;
    await keeper().check();
    expect(started).toEqual([]);
    expect(await shouldRun()).toBe(1);
  });
});
