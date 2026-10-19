import type { Candle, Position } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoBrokerAdapter } from "@wickwatch/adapter-demo";
import {
  chartWindow,
  createCandleCache,
  MAX_BARS,
  openBar,
  partPeriod,
  timedPeriods,
} from "../src/services/trade-chart";
import { loginAs, startApp, type TestApp } from "./helpers";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PERIODS = ["t100", "M1", "M5", "M15", "H1", "H4", "D1"];
const SECONDS: Record<string, number> = { M1: 60, M5: 300, M15: 900, H1: 3600, H4: 14_400, D1: 86_400 };
const seconds = (period: string) => SECONDS[period];
const at = (iso: string) => Date.parse(iso);
const TIMED = timedPeriods(PERIODS, seconds);

describe("chartWindow", () => {
  const now = at("2026-10-16T20:00:00.000Z");

  it("keeps the instance's period and adds bars before the opening and after the close", () => {
    const trade = { opened: at("2026-10-16T10:02:00.000Z"), closed: at("2026-10-16T12:00:00.000Z"), now };
    // 2 h on M5 are 24 bars: 30 before (at least), 10 after (at least).
    expect(chartWindow(trade, "M5", TIMED)).toEqual({
      period: "M5",
      ms: 5 * MINUTE,
      from: at("2026-10-16T10:00:00.000Z") - 30 * 5 * MINUTE,
      to: at("2026-10-16T12:50:00.000Z"),
    });
  });

  it("ends an open position's chart at the current bar, and a just closed one's too", () => {
    const opened = at("2026-10-16T19:00:00.000Z");
    expect(chartWindow({ opened, now: now + 7 * MINUTE }, "M5", TIMED).to).toBe(at("2026-10-16T20:05:00.000Z"));
    expect(chartWindow({ opened, closed: now - MINUTE, now }, "M5", TIMED).to).toBe(now);
  });

  it("takes the next longer period when the trade does not fit, any one that fits without a period", () => {
    // Three days on M5 are 864 bars; on M15 288, with the bars around 419.
    const trade = { opened: at("2026-10-13T10:00:00.000Z"), closed: at("2026-10-16T10:00:00.000Z"), now };
    expect(chartWindow(trade, "M5", TIMED).period).toBe("M15");
    expect(chartWindow(trade, "H1", TIMED).period).toBe("H1");
    expect(chartWindow(trade, undefined, TIMED).period).toBe("M15");
    // A tick period has no length: any period that fits.
    expect(chartWindow(trade, "t100", TIMED).period).toBe("M15");
    const short = { opened: at("2026-10-16T10:00:00.000Z"), closed: at("2026-10-16T10:03:00.000Z"), now };
    expect(chartWindow(short, undefined, TIMED).period).toBe("M1");
  });

  it("stays within MAX_BARS and falls back to the longest period for a very long trade", () => {
    const opened = at("2025-01-01T00:00:00.000Z");
    const window = chartWindow({ opened, now }, "H4", TIMED);
    expect(window.period).toBe("D1");
    const year = chartWindow({ opened: at("2024-01-01T00:00:00.000Z"), now }, "D1", TIMED);
    expect(year.period).toBe("D1");
    const fitting = chartWindow({ opened: now - 10 * HOUR, now }, "M5", TIMED);
    expect((fitting.to - fitting.from) / (5 * MINUTE)).toBeLessThanOrEqual(MAX_BARS);
  });

  it("knows no period based on time among ticks", () => {
    expect(timedPeriods(["t100"], seconds)).toEqual([]);
  });
});

describe("createCandleCache", () => {
  const candle: Candle = { time: "2026-10-16T10:00:00.000Z", open: 1, high: 2, low: 0.5, close: 1.5 };
  const account = {
    id: 1,
    number: "1",
    displayName: "",
    broker: "",
    currency: "USD",
    credentials: async () => ({ login: "l", secret: "s" }),
  };
  const window = { period: "M5", ms: 5 * MINUTE, from: 0, to: 5 * MINUTE };
  const later = () => at("2026-10-16T20:00:00.000Z");

  it("asks the broker once per window, again after a failure", async () => {
    const candles = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue([candle]);
    const cache = createCandleCache({ candles, timed: TIMED }, later);
    await expect(cache.get(account, "GER40", window)).rejects.toThrow("down");
    expect(await cache.get(account, "GER40", window)).toEqual([candle]);
    expect(await cache.get(account, "GER40", window)).toEqual([candle]);
    expect(candles).toHaveBeenCalledTimes(2);
    await cache.get(account, "GER40", { ...window, to: 10 * MINUTE });
    expect(candles).toHaveBeenCalledTimes(3);
    expect(candles).toHaveBeenLastCalledWith(
      { login: "l", secret: "s" },
      "1",
      "GER40",
      "M5",
      "1970-01-01T00:00:00.000Z",
      "1970-01-01T00:10:00.000Z",
    );
  });
  it("adds the bar still open, built from a shorter period, and asks again soon while it is open", async () => {
    let clock = at("2026-10-16T10:12:30.000Z");
    const bar = (time: string, open: number, high: number, low: number, close: number): Candle => ({
      time,
      open,
      high,
      low,
      close,
    });
    const closed = [bar("2026-10-16T10:00:00.000Z", 10, 12, 9, 11), bar("2026-10-16T10:05:00.000Z", 11, 13, 10, 12)];
    const parts = [bar("2026-10-16T10:10:00.000Z", 12, 14, 11, 13), bar("2026-10-16T10:11:00.000Z", 13, 15, 8, 9)];
    const candles = vi.fn((_c, _a, _s, period: string) => Promise.resolve(period === "M1" ? parts : closed));
    const cache = createCandleCache({ candles, timed: TIMED }, () => clock);
    const live = {
      period: "M5",
      ms: 5 * MINUTE,
      from: at("2026-10-16T10:00:00.000Z"),
      to: at("2026-10-16T10:10:00.000Z"),
    };

    expect(await cache.get(account, "GER40", live)).toEqual([...closed, bar("2026-10-16T10:10:00.000Z", 12, 15, 8, 9)]);
    expect(candles).toHaveBeenLastCalledWith(
      { login: "l", secret: "s" },
      "1",
      "GER40",
      "M1",
      "2026-10-16T10:10:00.000Z",
      "2026-10-16T10:12:30.000Z",
    );
    await cache.get(account, "GER40", live);
    expect(candles).toHaveBeenCalledTimes(2);
    clock += MINUTE;
    await cache.get(account, "GER40", live);
    expect(candles).toHaveBeenCalledTimes(4);
  });

  it("keeps a window of closed bars and asks no shorter period for it", async () => {
    const candles = vi.fn().mockResolvedValue([candle]);
    const cache = createCandleCache({ candles, timed: TIMED }, later);
    expect(await cache.get(account, "GER40", window)).toEqual([candle]);
    expect(candles).toHaveBeenCalledTimes(1);
  });
});

describe("openBar", () => {
  const part = (time: string, low: number, high: number): Candle => ({ time, open: low, high, low, close: high });

  it("takes the bar the newest part falls in, counted from the last closed one", () => {
    // Daily bars open at 21:00 UTC; after a gap the parts fall in a later bar.
    const last = at("2026-10-14T21:00:00.000Z");
    const parts = [part("2026-10-16T20:00:00.000Z", 5, 6), part("2026-10-16T21:00:00.000Z", 7, 8)];
    expect(openBar(parts, last, 24 * HOUR)).toEqual({
      time: "2026-10-16T21:00:00.000Z",
      open: 7,
      high: 8,
      low: 7,
      close: 8,
    });
  });

  it("is undefined without parts after the last closed bar", () => {
    const last = at("2026-10-16T10:00:00.000Z");
    expect(openBar([], last, HOUR)).toBeUndefined();
    expect(openBar([part("2026-10-16T10:30:00.000Z", 1, 2)], last, HOUR)).toBeUndefined();
  });

  it("builds a bar from at most 300 bars of the shortest period that fits", () => {
    expect(partPeriod(TIMED, 5 * MINUTE)?.period).toBe("M1");
    expect(partPeriod(TIMED, 24 * HOUR)?.period).toBe("M5");
    expect(partPeriod(TIMED, MINUTE)).toBeUndefined();
  });
});

describe("GET /accounts/:number/positions/:positionId/chart", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await startApp();
  });
  afterEach(async () => {
    await t.app.close();
  });

  const url = (query: Record<string, string>, account = "1111111", position = "p1") =>
    `/api/v1/accounts/${account}/positions/${position}/chart?${new URLSearchParams(query).toString()}`;

  it("returns candles of the demo broker and the stops wickwatch saw, also to a viewer", async () => {
    const opened = new Date(Date.now() - 2 * HOUR).toISOString();
    const position: Position = {
      id: "p1",
      symbol: "GER40",
      side: "buy",
      volume: 1,
      entry: 100,
      sl: 90,
      pnl: 0,
      openedAt: opened,
    };
    vi.spyOn(t.adapters.broker, "positions").mockResolvedValue([position]);
    const cookie = await loginAs(t, "viewer");
    await t.app.inject({ url: "/api/v1/overview", headers: { cookie } });

    const res = await t.app.inject({ url: url({ symbol: "GER40", from: opened, period: "M5" }), headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const chart = res.json<{ period: string; candles: Candle[]; levels: unknown[] }>();
    expect(chart.period).toBe("M5");
    // 30 bars before the opening, 24 since; the one still open is built from M1 once a minute of it has passed.
    expect(chart.candles.length).toBeGreaterThanOrEqual(50);
    expect(Date.now() - Date.parse(chart.candles.at(-1)?.time ?? "")).toBeLessThan(6 * MINUTE);
    expect(Date.parse(chart.candles[0]?.time ?? "")).toBeLessThan(Date.parse(opened) - 29 * 5 * MINUTE);
    expect(chart.levels).toEqual([{ at: expect.any(String) as string, sl: 90 }]);
    // A period from a container label in another case is the broker's own.
    const label = await t.app.inject({
      url: url({ symbol: "GER40", from: opened, period: "m5" }),
      headers: { cookie },
    });
    expect(label.json<{ period: string }>().period).toBe("M5");
  });

  it("refuses periods the broker does not offer, ranges backwards or in the future, unknown accounts", async () => {
    const cookie = await loginAs(t, "viewer");
    const get = async (query: Record<string, string>, account?: string) =>
      (await t.app.inject({ url: url(query, account), headers: { cookie } })).statusCode;
    const from = "2026-10-16T10:00:00.000Z";
    expect(await get({ symbol: "GER40", from, period: "W1" })).toBe(400);
    expect(await get({ symbol: "GER40", from, to: "2026-10-16T09:00:00.000Z" })).toBe(400);
    expect(await get({ symbol: "GER40", from: new Date(Date.now() + HOUR).toISOString() })).toBe(400);
    expect(await get({ symbol: "GER40", from: "yesterday" })).toBe(400);
    expect(await get({ symbol: "GER40", from }, "9999999")).toBe(404);
    expect(await get({ symbol: "NOPE", from })).toBe(404);
  });

  it("is 501 when the broker adapter has no candles, and needs a login", async () => {
    expect((await t.app.inject({ url: url({ symbol: "GER40", from: "2026-10-16T10:00:00.000Z" }) })).statusCode).toBe(
      401,
    );
    const proto = DemoBrokerAdapter.prototype as { candles?: unknown };
    const candles = proto.candles;
    delete proto.candles;
    try {
      const without = await startApp();
      const cookie = await loginAs(without, "viewer");
      const get = (path: string) => without.app.inject({ url: path, headers: { cookie } });
      expect((await get(url({ symbol: "GER40", from: "2026-10-16T10:00:00.000Z" }))).statusCode).toBe(501);
      expect((await get("/api/v1/system")).json()).toMatchObject({ charts: false });
      await without.app.close();
    } finally {
      proto.candles = candles;
    }
  });
});
