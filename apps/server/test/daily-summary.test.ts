import type { Overview } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailySummary, localClock, type SummaryEvent } from "../src/services/daily-summary";
import { startApp, type TestApp } from "./helpers";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

const overview: Overview = {
  time: "2026-09-30T19:30:00.000Z",
  accounts: [
    {
      number: "7532555",
      displayName: "Challenge US100",
      currency: "USD",
      state: "running",
      balance: 9960.79,
      equity: 9960.79,
      dayPnl: -101.26,
      openPositions: 0,
      instances: { total: 1, running: 1 },
      challenge: {
        name: "FTMO",
        day: 185,
        status: "running",
        tradingDayStart: "2026-09-29T22:00:00.000Z",
        rules: [
          { id: "dailyLoss", status: "ok", value: 1, limit: 5, usage: 0.2, unit: "percent" },
          { id: "tradingDays", status: "reached", value: 48, limit: 4, usage: 12, unit: "days" },
        ],
      },
    },
    {
      number: "5902789",
      displayName: "5902789",
      state: "error",
      error: "auth_failed",
      openPositions: 0,
      instances: { total: 2, running: 0 },
    },
  ],
  instances: [],
  alerts: [{ level: "error", code: "account_error", subject: "5902789", params: { reason: "auth_failed" } }],
};

let t: TestApp;
let posts: SummaryEvent[];
let status: number;
let now: Date;
beforeEach(async () => {
  t = await startApp();
  posts = [];
  status = 200;
  now = new Date("2026-09-30T19:29:00.000Z");
});
afterEach(async () => {
  await t.app.close();
});

const summary = () =>
  new DailySummary({
    db: t.db,
    load: async () => overview,
    webhookUrl: new URL("https://hooks.example/summary"),
    time: "21:30",
    timeZone: "Europe/Berlin",
    locale: "en",
    log,
    now: () => now,
    fetch: (async (_url: URL, init: RequestInit) => {
      posts.push(JSON.parse(init.body as string) as SummaryEvent);
      return new Response(null, { status });
    }) as unknown as typeof fetch,
  });

describe("daily summary", () => {
  it("tells the local date and time in a time zone", () => {
    // 22:30 UTC is already the next day in Berlin (UTC+2 in summer).
    expect(localClock(new Date("2026-09-30T22:30:00Z"), "Europe/Berlin")).toEqual({ day: "2026-10-01", time: "00:30" });
    expect(localClock(new Date("2026-09-30T22:30:00Z"), "UTC")).toEqual({ day: "2026-09-30", time: "22:30" });
  });

  it("sends once a day from its time on, and not again after a restart", async () => {
    const s = summary();
    // 21:29 in Berlin: not yet.
    expect(await s.check()).toBe(false);
    now = new Date("2026-09-30T19:30:00.000Z");
    expect(await s.check()).toBe(true);
    expect(await summary().check()).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ event: "daily_summary", date: "2026-09-30", alerts: 1 });
    expect(posts[0]?.text.split("\n")).toEqual([
      "wickwatch daily summary 2026-09-30",
      "Challenge US100 (7532555): balance 9,960.79 USD, equity 9,960.79 USD, P&L today (UTC) -101.26 USD, open positions 0, instances running 1 of 1",
      "  Challenge day 185, Running: Daily loss 1.0 % of 5.0 % · Trading days 48 of 4",
      "5902789: not reachable (Login failed – check the credentials.)",
      "Open alerts: 1",
    ]);
  });

  it("tries again while the webhook fails", async () => {
    now = new Date("2026-09-30T20:00:00.000Z");
    status = 500;
    expect(await summary().check()).toBe(false);
    status = 200;
    expect(await summary().check()).toBe(true);
    expect(posts).toHaveLength(2);
  });
});
