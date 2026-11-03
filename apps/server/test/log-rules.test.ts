import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogLine, LogRule, RuntimeAdapter, RuntimeInstance } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogRules, logRuleEvents } from "../src/services/log-rules";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let algo: string;

const START = Date.parse("2026-11-03T08:00:00.000Z");
const at = (seconds: number) => new Date(START + seconds * 1000).toISOString();

beforeEach(async () => {
  t = await startApp({ ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")) });
  admin = await loginAs(t, "admin");
  const upload = await t.app.inject({
    method: "POST",
    url: "/api/v1/algos?fileName=alpha.algo",
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    payload: Buffer.from("alpha-v1"),
  });
  const { id, name } = upload.json<{ id: number; name: string }>();
  algo = name;
  const account = await t.db
    .selectFrom("accounts")
    .select("id")
    .where("number", "=", "1111111")
    .executeTakeFirstOrThrow();
  const created = await inject("POST", "/managed-instances", {
    name: "bot-a",
    accountId: account.id,
    config: { algoId: id, symbol: "GER40", period: "m5", parameters: {}, attribution: { mode: "auto" } },
  });
  expect(created.statusCode).toBe(201);
});
afterEach(async () => {
  await t.app.close();
});

const inject = (method: "GET" | "POST" | "PUT", url: string, payload?: object, cookie = admin) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

const rule = (overrides: Partial<LogRule> = {}): LogRule => ({
  pattern: "Interner Takt des Bots hängt",
  regex: false,
  waitSeconds: 120,
  action: "restart",
  withOpenPosition: true,
  cooldownMinutes: 30,
  maxPerDay: 6,
  ...overrides,
});
const saveRules = (...rules: LogRule[]) => inject("PUT", `/algo-settings/${algo}`, { logRules: rules });

const line = (seconds: number, text: string): LogLine => ({ time: at(seconds), text, level: "info" });
const HANG = "Interner Takt des Bots hängt";

/** The service on a runtime with one running instance "bot-a", with its log and clock in the test's hands. */
function harness(openPositions: () => Promise<number | undefined> = async () => 0) {
  const lines: LogLine[] = [];
  const instance: RuntimeInstance = {
    ref: "bot-a",
    status: "running",
    labels: {},
    restartCount: 0,
    startedAt: at(-3600),
  };
  const runtime = {
    list: async () => [instance],
    logs: async function* (_ref: string, options?: { since?: string }) {
      for (const l of lines) if (!options?.since || l.time >= options.since) yield l;
    },
    restart: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  let now = START;
  const service = new LogRules({
    db: t.db,
    runtime: runtime as unknown as RuntimeAdapter,
    openPositions,
    log: { error: vi.fn(), warn: vi.fn() } as never,
    now: () => new Date(now),
  });
  return {
    runtime,
    /** Log lines this many seconds after START. */
    write: (...entries: [number, string][]) => lines.push(...entries.map(([seconds, text]) => line(seconds, text))),
    /** A check this many seconds after START. */
    checkAt: async (seconds: number) => {
      now = START + seconds * 1000;
      await service.check();
    },
    events: () => logRuleEvents(t.db, new Date(now), 3_600_000),
  };
}

describe("log rules", () => {
  it("restarts on a matching line once per cooldown, leaves lines from before alone, and says so", async () => {
    await saveRules(rule());
    const h = harness();
    h.write([-10, `${HANG} seit 30 Sek. (vor dem Start)`]);
    await h.checkAt(0);
    expect(h.runtime.restart).not.toHaveBeenCalled();

    h.write([5, "03/11 | Info | ⚠️ INTERNER TAKT DES BOTS HÄNGT seit ca. 30 Sek."]);
    await h.checkAt(10);
    expect(h.runtime.restart).toHaveBeenCalledWith("bot-a");

    // Within the cooldown: nothing.
    h.write([60, HANG]);
    await h.checkAt(70);
    expect(h.runtime.restart).toHaveBeenCalledTimes(1);

    expect((await h.events()).get("bot-a")).toMatchObject({ variant: "restarted", count: 1, pattern: HANG });
    const audited = await t.db
      .selectFrom("audit_log")
      .select("details")
      .where("action", "=", "instance.log_rule")
      .execute();
    expect(audited.map((a) => JSON.parse(a.details ?? "{}") as unknown)).toEqual([
      { ok: true, pattern: HANG, action: "restart" },
    ]);
  });

  it("waits for the recovery line and acts only without it", async () => {
    await saveRules(rule({ recoveryPattern: "Takt läuft wieder", waitSeconds: 60 }));
    const h = harness();
    await h.checkAt(0);
    h.write([5, HANG], [30, "✅ Interner Takt läuft wieder (Pause ca. 55 Sek)."]);
    await h.checkAt(10);
    await h.checkAt(120);
    expect(h.runtime.restart).not.toHaveBeenCalled();

    h.write([200, HANG]);
    await h.checkAt(210);
    expect(h.runtime.restart).not.toHaveBeenCalled();
    await h.checkAt(261);
    expect(h.runtime.restart).toHaveBeenCalledTimes(1);
  });

  it("does not try a failed action again within the cooldown", async () => {
    await saveRules(rule());
    const h = harness();
    h.runtime.restart.mockRejectedValueOnce(new Error("socket proxy down"));
    await h.checkAt(0);
    h.write([5, HANG]);
    await h.checkAt(10);
    h.write([20, HANG]);
    await h.checkAt(30);
    expect(h.runtime.restart).toHaveBeenCalledTimes(1);
    expect((await h.events()).get("bot-a")?.variant).toBe("failed");
  });

  it("stops for good with a stop rule, and leaves an instance with an open position alone if the rule says so", async () => {
    await saveRules(rule({ pattern: "fatal", action: "stop", withOpenPosition: false }));
    let open: number | undefined = 1;
    const asked = vi.fn(async () => open);
    const h = harness(asked);
    await h.checkAt(0);
    h.write([5, "fatal: broker refused"]);
    await h.checkAt(10);
    expect(h.runtime.stop).not.toHaveBeenCalled();
    expect((await h.events()).get("bot-a")?.variant).toBe("open_position");

    // Asked again only after a minute: each time costs an overview load.
    h.write([20, "fatal again"]);
    await h.checkAt(30);
    expect(asked).toHaveBeenCalledTimes(1);

    open = undefined;
    h.write([70, "fatal again"]);
    await h.checkAt(75);
    expect(h.runtime.stop).not.toHaveBeenCalled();

    open = 0;
    h.write([140, "fatal once more"]);
    await h.checkAt(145);
    expect(h.runtime.stop).toHaveBeenCalledWith("bot-a");
    const row = await t.db
      .selectFrom("instances")
      .select("should_run")
      .where("name", "=", "bot-a")
      .executeTakeFirstOrThrow();
    expect(row.should_run).toBe(0);
  });

  it("says once when the daily limit is reached, and does nothing for an instance that opted out", async () => {
    await saveRules(rule({ cooldownMinutes: 1, maxPerDay: 1 }));
    const h = harness();
    await h.checkAt(0);
    for (const second of [5, 100, 200]) {
      h.write([second, HANG]);
      await h.checkAt(second + 5);
    }
    expect(h.runtime.restart).toHaveBeenCalledTimes(1);
    const variants = await t.db.selectFrom("log_rule_actions").select("variant").orderBy("id").execute();
    expect(variants.map((v) => v.variant)).toEqual(["restarted", "limit"]);

    expect((await inject("PUT", "/managed-instances/bot-a/log-rules", { enabled: false })).statusCode).toBe(204);
    await t.db.deleteFrom("log_rule_actions").execute();
    h.write([400, HANG]);
    await h.checkAt(405);
    expect(h.runtime.restart).toHaveBeenCalledTimes(1);
  });
});

describe("log rule settings", () => {
  it("stores the rules of an algo, ships them with its instances and refuses a broken regular expression", async () => {
    expect((await saveRules(rule({ regex: true, pattern: "Takt (hängt" }))).json()).toEqual({
      error: "log_rule_invalid",
    });
    const saved = await saveRules(rule(), rule({ action: "stop", pattern: "fatal" }));
    expect(saved.json<{ logRules: LogRule[] }>().logRules).toHaveLength(2);
    const detail = (await inject("GET", "/managed-instances/bot-a")).json<{
      logRules: boolean;
      algoLogRules: LogRule[];
    }>();
    expect(detail).toMatchObject({
      logRules: true,
      algoLogRules: [rule(), rule({ action: "stop", pattern: "fatal" })],
    });
    // Other settings stay when the rules change, and an empty list removes them.
    expect((await saveRules()).json<{ logRules?: LogRule[] }>().logRules).toBeUndefined();
  });

  it("lets only admins change rules and switch them off for an instance, and audits that", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await inject("PUT", `/algo-settings/${algo}`, { logRules: [rule()] }, viewer)).statusCode).toBe(403);
    expect((await inject("PUT", "/managed-instances/bot-a/log-rules", { enabled: false }, viewer)).statusCode).toBe(
      403,
    );
    expect((await inject("PUT", "/managed-instances/nope/log-rules", { enabled: false })).statusCode).toBe(404);
    expect((await inject("PUT", "/managed-instances/bot-a/log-rules", { enabled: false })).statusCode).toBe(204);
    expect((await inject("GET", "/managed-instances/bot-a")).json<{ logRules: boolean }>().logRules).toBe(false);
    const row = await t.db
      .selectFrom("audit_log")
      .select(["target", "details"])
      .where("action", "=", "instance.log_rules")
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ target: "bot-a", details: JSON.stringify({ enabled: false }) });
  });
});
