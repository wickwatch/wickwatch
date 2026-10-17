import { describe, expect, it } from "vitest";
import { barAt, tradeLines, type TradeLinesInput } from "../src/trade-chart";

const s = (iso: string) => Date.parse(iso) / 1000;
/** Hourly bars from 08:00 to 14:00. */
const bars = [8, 9, 10, 11, 12, 13, 14].map((h) => s(`2026-10-16T${String(h).padStart(2, "0")}:00:00.000Z`));
const base: TradeLinesInput = {
  bars,
  side: "buy",
  entry: 100,
  openedAt: "2026-10-16T09:30:00.000Z",
  closedAt: "2026-10-16T12:10:00.000Z",
  initialStopLoss: 90,
  levels: [],
};
const values = (points: { value?: number }[]) => points.map((p) => p.value);

describe("barAt", () => {
  it("finds the bar a moment falls in, also over a gap and before the first bar", () => {
    expect(barAt(bars, Date.parse("2026-10-16T10:59:59.000Z"))).toBe(bars[2]);
    expect(barAt(bars, Date.parse("2026-10-16T07:00:00.000Z"))).toBe(bars[0]);
    expect(barAt(bars, Date.parse("2026-10-17T07:00:00.000Z"))).toBe(bars[6]);
    expect(barAt([], 0)).toBeUndefined();
  });
});

describe("tradeLines", () => {
  it("draws the stops from the opening bar to the closing bar, each change in the bar it was noticed in", () => {
    const lines = tradeLines({
      ...base,
      levels: [
        // First seen a minute after the opening, then moved to break even and the target raised.
        { at: "2026-10-16T09:31:00.000Z", sl: 90, tp: 120 },
        { at: "2026-10-16T10:40:00.000Z", sl: 100, tp: 120 },
        { at: "2026-10-16T11:05:00.000Z", sl: 100, tp: 130 },
      ],
    });
    expect(lines).toMatchObject({ opened: bars[1], closed: bars[4], breakEven: bars[2] });
    expect(lines?.sl.map((p) => p.time)).toEqual(bars.slice(1, 5));
    expect(values(lines?.sl ?? [])).toEqual([90, 100, 100, 100]);
    // Seen a minute after the opening, still in its bar.
    expect(values(lines?.tp ?? [])).toEqual([120, 120, 130, 130]);
  });

  it("leaves gaps while no stop was set and knows no break even without an entry", () => {
    const lines = tradeLines({
      ...base,
      entry: undefined,
      initialStopLoss: undefined,
      levels: [{ at: "2026-10-16T09:31:00.000Z" }, { at: "2026-10-16T11:10:00.000Z", sl: 105 }],
    });
    expect(values(lines?.sl ?? [])).toEqual([undefined, undefined, 105, 105]);
    expect(lines?.breakEven).toBeUndefined();
    expect(values(lines?.tp ?? [])).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("starts the stop where wickwatch first saw it when the initial one is unknown, no break even for it", () => {
    const lines = tradeLines({
      ...base,
      initialStopLoss: undefined,
      levels: [{ at: "2026-10-16T10:30:00.000Z", sl: 101, tp: 120 }],
    });
    expect(values(lines?.sl ?? [])).toEqual([undefined, 101, 101, 101]);
    expect(values(lines?.tp ?? [])).toEqual([undefined, 120, 120, 120]);
    expect(lines?.breakEven).toBeUndefined();
  });

  it("counts break even for a sell when the stop comes down to the entry, not for one that started beyond it", () => {
    const sell = { ...base, side: "sell" as const, initialStopLoss: 110 };
    const moved = tradeLines({ ...sell, levels: [{ at: "2026-10-16T11:30:00.000Z", sl: 99 }] });
    expect(moved?.breakEven).toBe(bars[3]);
    expect(tradeLines({ ...sell, initialStopLoss: 95 })?.breakEven).toBeUndefined();
  });

  it("runs an open position to the last bar with its stops now", () => {
    const lines = tradeLines({
      ...base,
      closedAt: undefined,
      levels: [{ at: "2026-10-16T09:31:00.000Z", sl: 90, tp: 120 }],
      current: { sl: 95, tp: 120 },
    });
    expect(lines?.closed).toBeUndefined();
    expect(lines?.sl.at(-1)).toEqual({ time: bars[6], value: 95 });
    expect(values(lines?.sl ?? [])).toEqual([90, 90, 90, 90, 90, 95]);
    expect(lines?.breakEven).toBeUndefined();
  });

  it("is undefined without candles", () => {
    expect(tradeLines({ ...base, bars: [] })).toBeUndefined();
  });
});
