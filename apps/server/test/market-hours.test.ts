import type { InstanceSummary, MarketHours } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { dbAccountDirectory, type AccountEntry } from "../src/accounts";
import { MarketHoursCache } from "../src/services/market-hours";
import { loginAs, startApp, type TestApp } from "./helpers";

const HOUR = 60 * 60 * 1000;
const hours: MarketHours = { alwaysOpen: false, sessions: [{ start: 79_500, end: 161_400 }] };

let t: TestApp;
beforeEach(async () => {
  t = await startApp();
});
afterEach(async () => {
  await t.app.close();
});

describe("MarketHoursCache", () => {
  let now: number;
  let cache: MarketHoursCache;
  let ask: Mock<(...args: unknown[]) => Promise<MarketHours>>;
  let accounts: AccountEntry[];
  const instance: InstanceSummary = {
    ref: "a",
    name: "a",
    status: "running",
    restartCount: 0,
    openPositions: 0,
    dayPnl: 0,
  };
  const onUs30: InstanceSummary = { ...instance, account: "1111111", symbol: "US30" };
  const make = (marketHours: unknown) =>
    new MarketHoursCache({
      adapters: { ...t.adapters, broker: { ...t.adapters.broker, marketHours } } as never,
      log: { warn: vi.fn() } as never,
      now: () => now,
      jitter: () => 0,
    });

  beforeEach(async () => {
    now = Date.parse("2026-10-02T12:00:00Z");
    ask = vi.fn(() => Promise.resolve(hours));
    cache = make(ask);
    accounts = await dbAccountDirectory(t.db, t.cipher, "demo").list();
  });

  it("never waits for the broker: the first call asks in the background, later ones get the hours", async () => {
    expect(cache.attach([onUs30], accounts)[0]?.marketHours).toBeUndefined();
    await cache.settled();
    expect(cache.attach([onUs30], accounts)[0]?.marketHours).toEqual(hours);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.slice(1)).toEqual(["1111111", "US30"]);
  });

  it("asks once a day per account and symbol, and leaves instances without one alone", async () => {
    cache.attach([onUs30, onUs30, instance, { ...onUs30, account: "9999999" }], accounts);
    await cache.settled();
    now += 23 * HOUR;
    cache.attach([onUs30], accounts);
    expect(ask).toHaveBeenCalledTimes(1);
    now += 2 * HOUR;
    cache.attach([onUs30], accounts);
    await cache.settled();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("asks one symbol after the other per account, so the account's broker session is not crowded", async () => {
    const answers: (() => void)[] = [];
    ask.mockImplementation(
      () =>
        new Promise<MarketHours>((resolve) => {
          answers.push(() => {
            resolve(hours);
          });
        }),
    );
    cache.attach([onUs30, { ...onUs30, ref: "b", symbol: "GER40" }], accounts);
    await Promise.resolve();
    await Promise.resolve();
    expect(ask).toHaveBeenCalledTimes(1);
    answers[0]?.();
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(2);
    });
    answers[1]?.();
    await cache.settled();
  });

  it("keeps the hours it has when a query fails and tries again an hour later", async () => {
    cache.attach([onUs30], accounts);
    await cache.settled();
    now += 25 * HOUR;
    ask.mockRejectedValueOnce(new Error("broker down"));
    cache.attach([onUs30], accounts);
    await cache.settled();
    expect(cache.attach([onUs30], accounts)[0]?.marketHours).toEqual(hours);
    expect(ask).toHaveBeenCalledTimes(2);
    now += HOUR;
    cache.attach([onUs30], accounts);
    await cache.settled();
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("adds nothing when the broker adapter cannot tell", () => {
    expect(make(undefined).attach([onUs30], accounts)).toEqual([onUs30]);
  });
});

describe("market hours in the API", () => {
  it("come with the instances of the overview, the account page and the instance page", async () => {
    const admin = await loginAs(t, "admin");
    const get = (url: string) => t.app.inject({ url: `/api/v1${url}`, headers: { cookie: admin } });
    interface Summary {
      ref: string;
      account?: string;
      symbol?: string;
      marketHours?: MarketHours;
    }
    await get("/overview");
    await t.app.marketHours.settled();
    const instances = (await get("/overview")).json<{ instances: Summary[] }>().instances;
    const withSymbol = instances.find((i) => i.account && i.symbol);
    expect(withSymbol?.marketHours?.sessions).toHaveLength(5);

    const account = (await get(`/accounts/${String(withSymbol?.account)}/detail`)).json<{ instances: Summary[] }>();
    expect(account.instances.find((i) => i.ref === withSymbol?.ref)?.marketHours).toEqual(withSymbol?.marketHours);
    const detail = (await get(`/instances/${String(withSymbol?.ref)}`)).json<{ instance: Summary }>();
    expect(detail.instance.marketHours).toEqual(withSymbol?.marketHours);
  });
});
