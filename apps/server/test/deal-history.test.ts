import type { BrokerAdapter, Deal } from "@wickwatch/core";
import { describe, expect, it, vi } from "vitest";
import type { AccountEntry } from "../src/accounts";
import { createDealHistory } from "../src/services/deal-history";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const CUTOFF = Date.parse("2026-09-29T00:00:00.000Z") - 90 * DAY_MS;

const deal = (daysBeforeCutoff: number): Deal => ({
  id: `d${daysBeforeCutoff}`,
  positionId: `p${daysBeforeCutoff}`,
  symbol: "GER40",
  side: "buy",
  volume: 1,
  price: 1,
  pnl: 1,
  label: "alpha",
  time: new Date(CUTOFF - daysBeforeCutoff * DAY_MS).toISOString(),
});

const entry: AccountEntry = {
  id: 1,
  number: "111",
  displayName: "Main",
  broker: "demo",
  currency: "USD",
  credentials: () => Promise.resolve({ login: "l", secret: "s" }),
};
const log = { warn: vi.fn() } as unknown as Parameters<typeof createDealHistory>[1];

/** A broker that knows these deals and answers ranges like the adapters (both ends included). */
function brokerWith(deals: Deal[]) {
  const deals$ = vi.fn((_c: unknown, _a: string, from: string, to: string) =>
    Promise.resolve(deals.filter((d) => d.time >= from && d.time <= to)),
  );
  return { broker: { deals: deals$ } as unknown as BrokerAdapter, calls: deals$ };
}

describe("deal history", () => {
  it("walks back until two empty pieces, each deal once, oldest first", async () => {
    // A gap of one empty piece does not end the history; the deal on the cutoff belongs to the recent part.
    const { broker, calls } = brokerWith([deal(0), deal(10), deal(250), deal(95)]);
    const history = createDealHistory(broker, log, () => NOW);
    const older = await history.load(entry);
    expect(older.map((d) => d.id)).toEqual(["d250", "d95", "d10"]);
    // 0–90, 90–180, 180–270, then two empty pieces.
    expect(calls).toHaveBeenCalledTimes(5);
    expect(history.cutoff().getTime()).toBe(CUTOFF);
  });

  it("starts loading on peek and keeps the result for the day", async () => {
    const { broker, calls } = brokerWith([deal(10)]);
    let now = NOW;
    const history = createDealHistory(broker, log, () => now);
    expect(history.peek(entry)).toBeUndefined();
    await history.load(entry);
    expect(history.peek(entry)?.map((d) => d.id)).toEqual(["d10"]);
    const perLoad = calls.mock.calls.length;
    now += DAY_MS;
    await history.load(entry);
    expect(calls.mock.calls.length).toBe(2 * perLoad);
  });

  it("does not keep failures and waits before asking again", async () => {
    const deals = vi.fn(() => Promise.reject(new Error("down")));
    const broker = { deals } as unknown as BrokerAdapter;
    let now = NOW;
    const history = createDealHistory(broker, log, () => now);
    await expect(history.load(entry)).rejects.toThrow("down");
    expect(history.peek(entry)).toBeUndefined();
    await Promise.resolve();
    expect(deals).toHaveBeenCalledTimes(1);
    now += 6 * 60 * 1000;
    history.peek(entry);
    await vi.waitFor(() => {
      expect(deals).toHaveBeenCalledTimes(2);
    });
  });
});
