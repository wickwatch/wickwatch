import type { Alert, MarketHours, Overview } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, migrateToLatest, type Db } from "../src/db";
import { alertText } from "../src/services/alert-text";
import { AlertNotifier, type AlertEvent, type NotifierOptions } from "../src/services/notifier";

const WEBHOOK = new URL("https://hooks.example.com/secret-token");
const HEARTBEAT = new URL("https://hc.example.com/ping/uuid");
const NOW = new Date("2026-09-28T16:40:00.000Z");

const disconnected: Alert = {
  level: "warning",
  code: "instance_disconnected",
  subject: "alpha",
  params: { since: "2026-09-28T16:34:50.272Z" },
};
const loginFailed: Alert = {
  level: "error",
  code: "account_error",
  subject: "5902789",
  params: { reason: "auth_failed" },
};
const unreachable: Alert = { ...loginFailed, params: { reason: "unavailable" } };
const stopped: Alert = { level: "warning", code: "instance_stopped", subject: "alpha", params: {} };
const nearLimit: Alert = {
  level: "warning",
  code: "challenge_limit",
  subject: "5902789",
  params: { rule: "dailyLoss", used: 85 },
};

/** Names of the instances and numbers of the accounts that exist; a resolved alert of a missing one was removed. */
let present: { instances: string[]; accounts: string[] };
/** The broker's hours of every instance's symbol; unknown when unset. */
let hours: MarketHours | undefined;
const overview = (alerts: Alert[]): Overview => ({
  time: NOW.toISOString(),
  accounts: present.accounts.map((number) => ({ number })) as unknown as Overview["accounts"],
  instances: present.instances.map((name) => ({
    name,
    account: "5902789",
    marketHours: hours,
  })) as unknown as Overview["instances"],
  alerts,
});

let db: Db;
let alerts: Alert[];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let log: { warn: ReturnType<typeof vi.fn> };

const posted = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(init?.body as string) as AlertEvent);

/** With the webhook unless `webhook: false`. */
function notifier({ webhook = true, ...options }: Partial<NotifierOptions> & { webhook?: boolean } = {}) {
  return new AlertNotifier({
    db,
    load: () => Promise.resolve(overview(alerts)),
    ...(webhook ? { webhookUrl: WEBHOOK } : {}),
    locale: "en",
    log: log as unknown as FastifyBaseLogger,
    fetch: fetchMock,
    now: () => NOW,
    ...options,
  });
}

beforeEach(async () => {
  db = createDatabase({ client: "sqlite", filename: ":memory:" });
  await migrateToLatest(db);
  alerts = [];
  present = { instances: ["alpha"], accounts: ["5902789"] };
  hours = undefined;
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
  log = { warn: vi.fn() };
});

describe("AlertNotifier", () => {
  it("posts each new alert once and a resolution when it is gone", async () => {
    const n = notifier();
    alerts = [disconnected, loginFailed];
    await n.check();
    await n.check();
    expect(posted()).toEqual([
      {
        event: "alert_raised",
        time: NOW.toISOString(),
        ...disconnected,
        instance: "alpha",
        text: "Warning: alpha: connection to the broker lost since 9/28/26, 4:34 PM UTC",
        content: "Warning: alpha: connection to the broker lost since 9/28/26, 4:34 PM UTC",
      },
      expect.objectContaining({
        event: "alert_raised",
        account: "5902789",
        text: "Error: Account 5902789 not reachable: Login failed – check the credentials.",
      }),
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(WEBHOOK);

    alerts = [loginFailed];
    await n.check();
    expect(posted().slice(2)).toEqual([
      expect.objectContaining({
        event: "alert_resolved",
        code: "instance_disconnected",
        subject: "alpha",
        text: "Resolved: alpha is connected to the broker again",
      }),
    ]);
  });

  it("says what went away instead of what was wrong", async () => {
    const n = notifier();
    alerts = [disconnected, loginFailed];
    await n.check();

    // Disconnected turns into stopped: not a recovery, so the old text, and the new alert.
    alerts = [stopped, loginFailed];
    await n.check();
    expect(
      posted()
        .slice(2)
        .map((e) => e.text),
    ).toEqual([
      "Warning: alpha is stopped",
      "Resolved: alpha: connection to the broker lost since 9/28/26, 4:34 PM UTC",
    ]);

    // The instance is deleted and the account removed.
    present = { instances: [], accounts: [] };
    alerts = [];
    await n.check();
    expect(
      posted()
        .slice(4)
        .map((e) => e.text),
    ).toEqual(["Closed: account 5902789 was removed", "Closed: alpha was removed"]);
  });

  it("posts a lost connection only once it outlasted the grace time", async () => {
    // Lost 5 min 10 s before NOW.
    const n = notifier({ disconnectGraceMs: 10 * 60_000 });
    alerts = [disconnected, nearLimit];
    await n.check();
    expect(posted().map((e) => e.code)).toEqual(["challenge_limit"]);

    // Back before the grace time ended: neither the alert nor a resolution.
    alerts = [nearLimit];
    await n.check();
    expect(posted()).toHaveLength(1);

    alerts = [disconnected, nearLimit];
    await notifier({ disconnectGraceMs: 5 * 60_000 }).check();
    expect(posted().map((e) => e.code)).toEqual(["challenge_limit", "instance_disconnected"]);
  });

  it("waits longer while the market is closed", async () => {
    // NOW is a Monday afternoon; the only session is Sunday 00:00–00:01. Lost 5 min 10 s before NOW.
    hours = { alwaysOpen: false, sessions: [{ start: 0, end: 60 }] };
    alerts = [disconnected];
    const closed = (ms: number) => notifier({ disconnectGraceMs: 60_000, disconnectGraceClosedMs: ms }).check();
    await closed(30 * 60_000);
    await closed(Infinity);
    expect(posted()).toEqual([]);
    await closed(5 * 60_000);
    expect(posted().map((e) => e.code)).toEqual(["instance_disconnected"]);
  });

  it("holds an unreachable account from when it was first seen, but not a failed login", async () => {
    let now = NOW;
    const n = notifier({ disconnectGraceMs: 3 * 60_000, now: () => now });
    alerts = [unreachable];
    await n.check();
    now = new Date(NOW.getTime() + 2 * 60_000);
    await n.check();
    expect(posted()).toEqual([]);
    now = new Date(NOW.getTime() + 3 * 60_000);
    await n.check();
    expect(posted().map((e) => e.code)).toEqual(["account_error"]);

    present = { instances: ["alpha"], accounts: ["5902789", "other"] };
    alerts = [unreachable, { ...loginFailed, subject: "other" }];
    await n.check();
    expect(posted().map((e) => e.subject)).toEqual(["5902789", "other"]);
  });

  it("holds an unreachable account longer while the markets of its instances are closed", async () => {
    // The account's only instance trades Sunday 00:00–00:01; NOW is a Monday afternoon.
    hours = { alwaysOpen: false, sessions: [{ start: 0, end: 60 }] };
    let now = NOW;
    const n = notifier({ disconnectGraceMs: 3 * 60_000, disconnectGraceClosedMs: 30 * 60_000, now: () => now });
    alerts = [unreachable];
    await n.check();
    now = new Date(NOW.getTime() + 10 * 60_000);
    await n.check();
    expect(posted()).toEqual([]);
    now = new Date(NOW.getTime() + 30 * 60_000);
    await n.check();
    expect(posted().map((e) => e.code)).toEqual(["account_error"]);
  });

  it("resolves an alert only once it stayed away for the delay", async () => {
    let now = NOW;
    const n = notifier({ resolveDelayMs: 2 * 60_000, now: () => now });
    alerts = [loginFailed];
    await n.check();

    // Away for a minute and back: no resolution, no second alert.
    alerts = [];
    await n.check();
    now = new Date(NOW.getTime() + 60_000);
    alerts = [loginFailed];
    await n.check();
    expect(posted().map((e) => e.event)).toEqual(["alert_raised"]);

    alerts = [];
    now = new Date(NOW.getTime() + 2 * 60_000);
    await n.check();
    now = new Date(NOW.getTime() + 4 * 60_000);
    await n.check();
    // Resolved once.
    await n.check();
    expect(posted().map((e) => e.event)).toEqual(["alert_raised", "alert_resolved"]);
  });

  it("uses the open market's grace time while it is open, and when its hours are unknown", async () => {
    const options = { disconnectGraceMs: 60_000, disconnectGraceClosedMs: Infinity };
    alerts = [disconnected];
    await notifier(options).check();
    expect(posted()).toHaveLength(1);

    present = { instances: ["alpha", "beta"], accounts: [] };
    hours = { alwaysOpen: true, sessions: [] };
    alerts = [disconnected, { ...disconnected, subject: "beta" }];
    await notifier(options).check();
    expect(posted().map((e) => e.subject)).toEqual(["alpha", "beta"]);
  });

  it("does not repeat alerts after a restart", async () => {
    alerts = [loginFailed];
    await notifier().check();
    await notifier().check();
    expect(posted()).toHaveLength(1);
  });

  it("retries an alert the webhook did not take, without logging the URL", async () => {
    alerts = [loginFailed];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const n = notifier();
    await n.check();
    await n.check();
    expect(posted().map((e) => e.event)).toEqual(["alert_raised", "alert_raised"]);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("secret-token");
  });

  it("pings the heartbeat only after a successful check", async () => {
    let fail = false;
    const n = notifier({
      webhook: false,
      heartbeatUrl: HEARTBEAT,
      load: () => (fail ? Promise.reject(new Error("docker down")) : Promise.resolve(overview([loginFailed]))),
    });
    await n.check();
    fail = true;
    await n.check();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([HEARTBEAT]);
    expect(posted()).toEqual([]);
  });

  it("stays idle without URLs", () => {
    vi.useFakeTimers();
    try {
      const n = notifier({ webhook: false });
      n.start();
      vi.advanceTimersByTime(120_000);
      expect(fetchMock).not.toHaveBeenCalled();
      n.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("alertText", () => {
  it("uses the UI translations with the level in words", () => {
    expect(alertText(disconnected, "de")).toBe(
      "Achtung: alpha: Verbindung zum Broker seit 28.09.26, 16:34 UTC unterbrochen",
    );
    expect(
      alertText({ level: "error", code: "challenge_breached", subject: "1", params: { rule: "dailyLoss" } }, "de"),
    ).toBe("Fehler: Konto 1: Challenge-Regel verletzt – Tagesverlust");
    expect(
      alertText(
        {
          level: "error",
          code: "instance_crashed",
          subject: "alpha",
          params: { count: 3, last: "2026-09-28T16:29:01.899Z", detail: "x" },
        },
        "en",
      ),
    ).toBe("Error: alpha: the bot threw an error 3 times since its start, last at 9/28/26, 4:29 PM UTC");
  });

  it("names what is fine again, and falls back to the alert where nothing is known", () => {
    expect(alertText(stopped, "de", "recovered")).toBe("Behoben: alpha läuft wieder");
    const limit: Alert = {
      level: "warning",
      code: "challenge_limit",
      subject: "1",
      params: { rule: "dailyLoss", used: 85 },
    };
    expect(alertText(limit, "de", "recovered")).toBe("Behoben: Konto 1: Tagesverlust wieder unter der Warnschwelle");
    const breached: Alert = { level: "error", code: "challenge_breached", subject: "1", params: { rule: "dailyLoss" } };
    expect(alertText(breached, "en", "recovered")).toBe("Resolved: Account 1: challenge rule breached – Daily loss");
    expect(alertText(stopped, "de", "removed")).toBe("Erledigt: alpha wurde entfernt");
  });
});
