import { describe, expect, it } from "vitest";
import {
  dealR,
  dealResult,
  dealRisk,
  dealStats,
  positionRisk,
  withPositionR,
  withRisk,
  type Deal,
  type Position,
  type TradeDeal,
} from "../src";
import { positionCosts, positionGross } from "../src/money";

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
/** A builder from `defaults`; `undefined` in `over` leaves that field out. */
const builder =
  <T extends object>(defaults: T) =>
  (over: { [K in keyof T]?: T[K] | undefined } = {}): T =>
    Object.fromEntries(Object.entries({ ...defaults, ...over }).filter(([, v]) => v !== undefined)) as T;
const deal = builder(base);

const open: Position = {
  id: "p1",
  symbol: "US100",
  side: "buy",
  volume: 0.62,
  entry: 29214.23,
  price: 29293.43,
  initialStopLoss: 29164.23,
  // 49.10 before costs, less the commission booked so far.
  pnl: 47.6,
  commission: -1.5,
  sl: 29214.23,
  openedAt: "2026-09-23T12:00:00.000Z",
};
const position = builder(open);

describe("risk and R of open positions", () => {
  it("values the initial stop like the closed trade would, not the moved stop, and counts the costs in the R", () => {
    // As for the closed trade: 49.10 before costs for 79.2 points, 50 points to the initial stop are 31.00.
    expect(positionRisk(position())).toBe(31);
    expect(withPositionR(position())).toMatchObject({ r: 1.54 });
  });

  it("goes below zero for a losing sell, with swap counted as a cost", () => {
    const losing = position({
      side: "sell",
      entry: 30000,
      price: 30025,
      initialStopLoss: 30050,
      pnl: -27,
      commission: -1,
      swap: -1,
    });
    expect(positionRisk(losing)).toBe(50);
    expect(withPositionR(losing).r).toBe(-0.54);
  });

  it("takes the gross the broker reports over pnl less commission and swap, and knows costs only when reported", () => {
    // A broker that already deducts the closing half of the commission from the pnl.
    const both = position({ pnl: 46.1, grossPnl: 49.1 });
    expect(positionGross(both)).toBe(49.1);
    expect(positionCosts(both)).toBe(-3);
    expect(positionRisk(both)).toBe(31);
    expect(positionGross(position())).toBe(49.1);
    expect(positionCosts(position())).toBe(-1.5);
    expect(positionCosts(position({ commission: undefined }))).toBeUndefined();
  });

  it("knows no R without current price or initial stop, at the entry price, or with the stop on the winning side", () => {
    for (const p of [
      position({ price: undefined }),
      position({ initialStopLoss: undefined }),
      position({ price: 29214.23, pnl: -1.5 }),
      position({ initialStopLoss: 29250 }),
    ]) {
      expect(positionRisk(p)).toBeUndefined();
      expect(withPositionR(p)).not.toHaveProperty("r");
    }
  });
});

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

  it("gives the same numbers as walking all newer account deals for every trade", () => {
    // The former O(n²) implementation, kept as the reference.
    function reference(deals: Deal[], accountDeals: Deal[], balance: number | undefined): TradeDeal[] {
      const byTime = [...accountDeals].sort((a, b) => b.time.localeCompare(a.time));
      return deals.map((deal) => {
        const risk = dealRisk(deal);
        if (risk === undefined) return deal;
        const r = dealR(deal);
        let before: number | undefined;
        if (balance !== undefined) {
          before = balance;
          for (const d of byTime) {
            if (d.time < deal.time) break;
            before -= dealResult(d);
          }
        }
        return {
          ...deal,
          risk,
          ...(before !== undefined && before > 0 ? { riskPct: Math.round((risk / before) * 10000) / 100 } : {}),
          ...(r !== undefined ? { r } : {}),
        };
      });
    }
    // Deterministic pseudo-random numbers, so a failure can be reproduced.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const cents = (max: number) => Math.round((random() - 0.5) * max * 100) / 100;
    for (let run = 0; run < 50; run++) {
      const accountDeals = Array.from({ length: Math.floor(random() * 200) }, (_, i) => {
        // Few distinct times, so ties are common; some times without milliseconds.
        const time = new Date(Date.UTC(2026, 8, 1) + Math.floor(random() * 40) * 3_600_000).toISOString();
        return deal({
          id: String(i),
          time: random() < 0.2 ? time.replace(".000Z", "Z") : time,
          pnl: cents(500),
          commission: random() < 0.5 ? cents(5) : undefined,
          swap: random() < 0.3 ? cents(3) : undefined,
          initialStopLoss: random() < 0.8 ? 29164.23 : undefined,
        });
      });
      const own = accountDeals.filter(() => random() < 0.5);
      const balance = random() < 0.1 ? undefined : random() < 0.1 ? cents(100) : 10_000 + cents(2_000);
      expect(withRisk(own, accountDeals, balance)).toStrictEqual(reference(own, accountDeals, balance));
    }
  });
});
