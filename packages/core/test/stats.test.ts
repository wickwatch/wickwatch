import { describe, expect, it } from "vitest";
import { buildInstanceDetail, buildLabels, dealStats, type Deal } from "../src";

const deal = (pnl: number, extra: Partial<Deal> = {}): Deal => ({
  id: `d${pnl}${extra.time ?? ""}`,
  positionId: "p",
  symbol: "GER40",
  side: "sell",
  volume: 1,
  price: 19400,
  pnl,
  commission: -2,
  label: "alpha",
  time: "2026-09-25T09:00:00.000Z",
  ...extra,
});

describe("dealStats", () => {
  it("computes trades, win rate, profit factor and averages including costs", () => {
    const stats = dealStats([deal(102), deal(52), deal(-38), deal(0)]);
    expect(stats).toEqual({
      trades: 3,
      wins: 2,
      losses: 1,
      winRate: 2 / 3,
      profitFactor: 3.75,
      averageWin: 75,
      averageLoss: -40,
      grossProfit: 150,
      grossLoss: 40,
      // The opening deal (pnl 0) is not a trade, but its commission counts.
      net: 108,
    });
  });

  it("leaves ratios out when there is nothing to divide", () => {
    expect(dealStats([])).toEqual({ trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, net: 0 });
    expect(dealStats([deal(10)])).not.toHaveProperty("profitFactor");
  });
});

describe("buildInstanceDetail", () => {
  it("keeps only this instance's positions, orders and deals, oldest first", () => {
    const detail = buildInstanceDetail({
      time: new Date("2026-09-25T12:00:00.000Z"),
      from: new Date("2026-08-26T12:00:00.000Z"),
      labelPrefix: "ww",
      instance: {
        ref: "ww-alpha",
        labels: buildLabels("ww", { instance: "alpha", account: "111", symbol: "GER40" }),
        status: "running",
        restartCount: 0,
        image: "bot:1",
      },
      account: {
        number: "111",
        displayName: "Main",
        currency: "USD",
        data: {
          positions: [
            {
              id: "1",
              symbol: "GER40",
              side: "buy",
              volume: 1,
              entry: 1,
              pnl: 5,
              label: "alpha",
              openedAt: "2026-09-25T10:00:00.000Z",
            },
            {
              id: "2",
              symbol: "US30",
              side: "buy",
              volume: 1,
              entry: 1,
              pnl: 9,
              label: "beta",
              openedAt: "2026-09-25T10:00:00.000Z",
            },
          ],
          pendingOrders: [
            { id: "o", symbol: "GER40", type: "limit", side: "sell", volume: 1, price: 2, label: "alpha" },
          ],
          deals: [
            deal(30, { time: "2026-09-25T08:00:00.000Z" }),
            deal(-10, { time: "2026-09-24T08:00:00.000Z" }),
            deal(99, { label: "beta" }),
          ],
        },
      },
    });
    expect(detail.positions.map((p) => p.id)).toEqual(["1"]);
    expect(detail.pendingOrders).toHaveLength(1);
    expect(detail.deals.map((d) => d.time)).toEqual(["2026-09-24T08:00:00.000Z", "2026-09-25T08:00:00.000Z"]);
    expect(detail.stats).toMatchObject({ trades: 2, net: 16 });
    // Today's P&L: today's deal (30 − 2) plus the open position (5).
    expect(detail.instance).toMatchObject({ name: "alpha", dayPnl: 33, openPositions: 1, image: "bot:1" });
    expect(detail.account).toEqual({ number: "111", displayName: "Main", currency: "USD" });
  });
});
