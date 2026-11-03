import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { LogTracker } from "../src/services/log-tracker";
import { OverviewLoader, type OverviewLoaderOptions } from "../src/services/overview";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let log: { error: ReturnType<typeof vi.fn> };
let loader: OverviewLoader;
let accounts: number;

const makeLoader = (extra: Partial<OverviewLoaderOptions> = {}) =>
  new OverviewLoader({
    adapters: t.adapters,
    directory: dbAccountDirectory(t.db, t.cipher, "demo"),
    db: t.db,
    labelPrefix: "wickwatch",
    logTracker: new LogTracker(t.adapters.runtime),
    log: log as never,
    ...extra,
  });

beforeEach(async () => {
  t = await startApp();
  log = { error: vi.fn() };
  accounts = (await dbAccountDirectory(t.db, t.cipher, "demo").list()).length;
  loader = makeLoader();
});
afterEach(async () => {
  await t.app.close();
});

describe("OverviewLoader", () => {
  it("asks the broker once for callers that load at the same time", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const list = vi.spyOn(t.adapters.runtime, "list");
    const [a, b] = await Promise.all([loader.overview(), loader.overview()]);
    expect(accounts).toBeGreaterThan(1);
    expect(stats).toHaveBeenCalledTimes(accounts);
    expect(list).toHaveBeenCalledTimes(1);
    expect(b.accounts).toEqual(a.accounts);

    // Kept for a short while once done, e.g. for another browser tab; a change drops it.
    await loader.overview();
    expect(stats).toHaveBeenCalledTimes(accounts);
    loader.invalidate();
    await loader.overview();
    expect(stats).toHaveBeenCalledTimes(2 * accounts);
  });

  it("asks again once the shared load is older than its time to live", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const now = new Date();
    await loader.overview(now);
    await loader.overview(new Date(now.getTime() + 15_000));
    expect(stats).toHaveBeenCalledTimes(accounts);
    await loader.overview(new Date(now.getTime() + 15_001));
    expect(stats).toHaveBeenCalledTimes(2 * accounts);
  });

  it("drops the shared load after an action on bots or positions, whoever runs it", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const cookie = await loginAs(t, "admin");
    const overview = () => t.app.inject({ url: "/api/v1/overview", headers: { cookie } });
    await overview();
    await overview();
    expect(stats).toHaveBeenCalledTimes(accounts);
    expect(
      (await t.app.inject({ method: "POST", url: "/api/v1/instances/alpha-ger40-a/stop", headers: { cookie } }))
        .statusCode,
    ).toBe(204);
    await overview();
    expect(stats).toHaveBeenCalledTimes(2 * accounts);
  });

  it("shares an account's broker answer between its own loads and those of all, but not with an earlier time", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const now = new Date();
    await Promise.all([
      loader.accountDetail("1111111", now),
      loader.accountDetail("2222222", now),
      loader.overview(now),
      loader.overview(new Date(now.getTime() - 60_000)),
    ]);
    expect(stats).toHaveBeenCalledTimes(2 * accounts);
  });

  it("serves one account from a running load of all accounts, as its own load would", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const list = vi.spyOn(t.adapters.runtime, "list");
    const now = new Date();
    // The demo broker's prices move with the clock: hold it still, or the two loads may differ by a tick.
    vi.useFakeTimers({ toFake: ["Date"], now });
    try {
      const [, joined] = await Promise.all([loader.overview(now), loader.accountDetail("1111111", now)]);
      expect(stats).toHaveBeenCalledTimes(accounts);
      expect(list).toHaveBeenCalledTimes(1);

      loader.invalidate();
      const own = await loader.accountDetail("1111111", now);
      expect(stats).toHaveBeenCalledTimes(accounts + 1);
      expect(joined).toEqual(own);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("while the broker does not answer", () => {
    /** Makes the broker's next `stats` call wait until the returned function is called. */
    function hangStats() {
      let release = () => {};
      const hanging = new Promise<void>((resolve) => (release = resolve));
      const real = t.adapters.broker.stats.bind(t.adapters.broker);
      const stats = vi.spyOn(t.adapters.broker, "stats").mockImplementationOnce(async (...args) => {
        await hanging;
        return real(...args);
      });
      return { stats, release };
    }
    /** Loads while the broker's next `stats` call hangs and expects the load to wait for it. */
    async function expectWaits(fast: OverviewLoader, at: Date) {
      const { release } = hangStats();
      let loaded = false;
      const detail = fast.accountDetail("1111111", at).then((d) => {
        loaded = true;
        return d;
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(loaded).toBe(false);
      release();
      expect((await detail)?.account.asOf).toBeUndefined();
    }

    it("shows the last answer with its time, asks once, and shows the new answer once there", async () => {
      const fast = makeLoader({ answerWaitMs: 20 });
      const now = new Date();
      expect((await fast.accountDetail("1111111", now))?.account.asOf).toBeUndefined();
      const { stats, release } = hangStats();

      const later = new Date(now.getTime() + 60_000);
      const [first, second] = [
        await fast.accountDetail("1111111", later),
        // Shared until the query is done: no second query behind the hanging one.
        await fast.accountDetail("1111111", new Date(later.getTime() + 1000)),
      ];
      for (const detail of [first, second]) {
        expect(detail?.account.asOf).toBe(now.toISOString());
        expect(detail?.account.state).not.toBe("error");
        expect(detail?.account.balance).toBeDefined();
      }
      expect(stats).toHaveBeenCalledTimes(1);

      release();
      await vi.waitFor(async () => {
        expect((await fast.accountDetail("1111111", new Date(later.getTime() + 2000)))?.account.asOf).toBeUndefined();
      });
      // The answer, asked shortly before, is used without asking again.
      expect(stats).toHaveBeenCalledTimes(1);
    });

    it("waits for the broker without an answer to show: at the start, after a change, or when it is too old", async () => {
      const fast = makeLoader({ answerWaitMs: 20 });
      const now = new Date();
      await expectWaits(fast, now);
      // After a change through wickwatch: the last answer may be from before it.
      fast.invalidate();
      await expectWaits(fast, new Date(now.getTime() + 1000));
      // More than five minutes after the last answer was asked.
      await expectWaits(fast, new Date(now.getTime() + 1000 + 5 * 60_000 + 1));
    });
  });

  it("derives the time-dependent parts with each caller's own time", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 1000);
    const [first, second] = await Promise.all([loader.overview(now), loader.overview(later)]);
    expect(first.time).toBe(now.toISOString());
    expect(second.time).toBe(later.toISOString());
  });

  it("logs a failed broker query once, however many callers share it", async () => {
    vi.spyOn(t.adapters.broker, "stats").mockRejectedValue(new Error("boom"));
    const [a, b] = await Promise.all([loader.overview(), loader.overview()]);
    expect(log.error).toHaveBeenCalledTimes(accounts);
    for (const overview of [a, b]) {
      expect(overview.accounts.every((account) => account.state === "error")).toBe(true);
    }
  });
});
