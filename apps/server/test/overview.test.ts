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
    log: () => log as never,
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
      loader.overview(now),
      loader.accountDetail("1111111", now),
      loader.overview(new Date(now.getTime() - 60_000)),
    ]);
    expect(stats).toHaveBeenCalledTimes(2 * accounts + 1);
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
