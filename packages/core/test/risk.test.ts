import { describe, expect, it } from "vitest";
import { dealR, dealRisk, dealStats, withRisk, type Deal } from "../src";

const base: Deal = {
  id: "1",
  positionId: "p1",
  symbol: "US100",
  side: "buy",
  volume: 0.62,
  price: 29293.43,
  pnl: 49.1,
  commission: -1.5,
  time: "2026-09-23T13:40:00.000Z",
  entryPrice: 29214.23,
  initialStopLoss: 29164.23,
};
/** `undefined` in `over` leaves that field out. */
const deal = (over: { [K in keyof Deal]?: Deal[K] | undefined } = {}): Deal =>
  Object.fromEntries(Object.entries({ ...base, ...over }).filter(([, v]) => v !== undefined)) as Deal;

describe("risk and R", () => {
  it("values the stop distance like the trade's own price move", () => {
    // 49.10 for 79.2 points: 50 points to the stop are 31.00.
    expect(dealRisk(deal())).toBe(31);
    expect(dealR(deal())).toBe(1.54);
  });

  it("gives -1R when the initial stop is hit, for sells too", () => {
    const stopped = deal({
      side: "sell",
      entryPrice: 30000,
      initialStopLoss: 30050,
      price: 30050,
      pnl: -50,
      commission: 0,
    });
    expect(dealRisk(stopped)).toBe(50);
    expect(dealR(stopped)).toBe(-1);
  });

  it("knows no risk without entry or stop, at the entry price, or with the stop on the winning side", () => {
    expect(dealRisk(deal({ initialStopLoss: undefined }))).toBeUndefined();
    expect(dealRisk(deal({ entryPrice: undefined }))).toBeUndefined();
    expect(dealRisk(deal({ price: 29214.23, pnl: 0 }))).toBeUndefined();
    expect(dealRisk(deal({ initialStopLoss: 29250 }))).toBeUndefined();
  });

  it("puts the risk in % of the balance before the trade", () => {
    const later = deal({
      id: "2",
      time: "2026-09-24T10:00:00.000Z",
      pnl: 200,
      commission: 0,
      initialStopLoss: undefined,
    });
    // Now 10,200; before the first trade 10,200 - 200 - 47.60 = 9,952.40; 31 of it are 0.31 %.
    const [first] = withRisk([deal()], [deal(), later], 10_200);
    expect(first).toMatchObject({ risk: 31, riskPct: 0.31, r: 1.54 });
    expect(withRisk([later], [later], 10_200)[0]).not.toHaveProperty("risk");
  });

  it("averages and sums R over the trades whose risk is known", () => {
    const stats = dealStats([
      deal(),
      deal({ id: "2", price: 29164.23, pnl: -31, commission: 0 }),
      deal({ id: "3", initialStopLoss: undefined }),
    ]);
    expect(stats).toMatchObject({ rTrades: 2, totalR: 0.54, averageR: 0.27 });
  });
});
