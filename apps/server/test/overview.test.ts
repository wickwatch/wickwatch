import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { LogTracker } from "../src/services/log-tracker";
import { OverviewLoader } from "../src/services/overview";
import { startApp, type TestApp } from "./helpers";

let t: TestApp;
let log: { error: ReturnType<typeof vi.fn> };
let loader: OverviewLoader;
let accounts: number;

beforeEach(async () => {
  t = await startApp();
  log = { error: vi.fn() };
  const directory = dbAccountDirectory(t.db, t.cipher, "demo");
  accounts = (await directory.list()).length;
  loader = new OverviewLoader({
    adapters: t.adapters,
    directory,
    db: t.db,
    labelPrefix: "wickwatch",
    logTracker: new LogTracker(t.adapters.runtime),
    log: log as never,
  });
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

    // Nothing is kept once the load is done.
    await loader.overview();
    expect(stats).toHaveBeenCalledTimes(2 * accounts);
  });

  it("keeps loads of different accounts and of an earlier time apart", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const now = new Date();
    await Promise.all([
      loader.accountDetail("1111111", now),
      loader.accountDetail("2222222", now),
      loader.overview(now),
      loader.overview(new Date(now.getTime() - 60_000)),
    ]);
    expect(stats).toHaveBeenCalledTimes(2 * accounts + 2);
  });

  it("serves one account from a running load of all accounts, as its own load would", async () => {
    const stats = vi.spyOn(t.adapters.broker, "stats");
    const list = vi.spyOn(t.adapters.runtime, "list");
    const now = new Date();
    const [, joined] = await Promise.all([loader.overview(now), loader.accountDetail("1111111", now)]);
    expect(stats).toHaveBeenCalledTimes(accounts);
    expect(list).toHaveBeenCalledTimes(1);

    const own = await loader.accountDetail("1111111", now);
    expect(stats).toHaveBeenCalledTimes(accounts + 1);
    expect(joined).toEqual(own);
  });

  it("does not join a load that started too long ago, e.g. behind a hanging broker session", async () => {
    let release = () => {};
    const hanging = new Promise<void>((resolve) => (release = resolve));
    const real = t.adapters.broker.stats.bind(t.adapters.broker);
    const stats = vi.spyOn(t.adapters.broker, "stats").mockImplementationOnce(async (...args) => {
      await hanging;
      return real(...args);
    });
    const now = new Date();
    const first = loader.accountDetail("1111111", now);

    // Later callers get fresh data of their own; the ones after them join that load.
    const later = new Date(now.getTime() + 10_000);
    const [second, third] = await Promise.all([
      loader.accountDetail("1111111", later),
      loader.accountDetail("1111111", new Date(later.getTime() + 1000)),
    ]);
    expect(second?.time).toBe(later.toISOString());
    expect(third?.account.state).not.toBe("error");
    expect(stats).toHaveBeenCalledTimes(2);

    release();
    expect((await first)?.time).toBe(now.toISOString());
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
