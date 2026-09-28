import type { Alert, Overview } from "@wickwatch/core";
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
const overview = (alerts: Alert[]): Overview => ({ time: NOW.toISOString(), accounts: [], instances: [], alerts });

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
        text: "Resolved: alpha: connection to the broker lost since 9/28/26, 4:34 PM UTC",
      }),
    ]);
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
});
