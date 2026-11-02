import type { BrokerAdapter, Deal, Position, RuntimeAdapter, RuntimeInstance } from "@wickwatch/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdleAccounts } from "../src/services/idle-accounts";

const MINUTE = 60_000;
const c = { login: "user", secret: "placeholder" };
const position: Position = {
  id: "p1",
  symbol: "GER40",
  side: "buy",
  volume: 1,
  entry: 100,
  pnl: 0,
  openedAt: "2026-11-03T08:00:00.000Z",
};
const deal = (id: string, time: string) => ({ id, time }) as unknown as Deal;

let now: number;
let positions: Position[];
let instances: RuntimeInstance[];
let broker: {
  stats: ReturnType<typeof vi.fn>;
  positions: ReturnType<typeof vi.fn>;
  pendingOrders: ReturnType<typeof vi.fn>;
  deals: ReturnType<typeof vi.fn>;
  closePosition: ReturnType<typeof vi.fn>;
};
let runtime: { list: ReturnType<typeof vi.fn> };
let idle: IdleAccounts;

const instance = (account: string | undefined, status: RuntimeInstance["status"]): RuntimeInstance => ({
  ref: "bot",
  labels: account === undefined ? {} : { "wickwatch.account": account },
  status,
  restartCount: 0,
});

/** One round as the poller and the overview ask. */
async function round() {
  await idle.broker.stats(c, "1001");
  await idle.broker.positions(c, "1001");
  await idle.broker.pendingOrders(c, "1001");
}

beforeEach(() => {
  now = Date.parse("2026-11-03T09:00:00.000Z");
  positions = [];
  instances = [];
  broker = {
    stats: vi.fn(() => Promise.resolve({ balance: 10_000, equity: 10_000 })),
    positions: vi.fn(() => Promise.resolve(positions)),
    pendingOrders: vi.fn(() => Promise.resolve([])),
    deals: vi.fn(() =>
      Promise.resolve([deal("d1", "2026-11-03T07:00:00.000Z"), deal("d2", "2026-11-03T08:30:00.000Z")]),
    ),
    closePosition: vi.fn(() => Promise.resolve()),
  };
  runtime = { list: vi.fn(() => Promise.resolve(instances)) };
  idle = new IdleAccounts({
    broker: { ...broker, id: "test", capabilities: () => ({ pendingOrders: true }) } as unknown as BrokerAdapter,
    runtime: runtime as unknown as RuntimeAdapter,
    labelPrefix: "wickwatch",
    refreshMs: 30 * MINUTE,
    now: () => now,
  });
});

describe("IdleAccounts", () => {
  it("reuses the answers for an account without a bot, position or order until they are too old", async () => {
    await round();
    now += 10 * MINUTE;
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(1);
    expect(broker.positions).toHaveBeenCalledTimes(1);

    now += 21 * MINUTE;
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(2);
    expect(broker.positions).toHaveBeenCalledTimes(2);
  });

  it("asks every time while the account has an open position", async () => {
    positions = [position];
    await round();
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(2);
    expect(broker.positions).toHaveBeenCalledTimes(2);
  });

  it("asks every time while a bot on the account is not stopped", async () => {
    instances = [instance("1001", "running"), instance("2002", "stopped")];
    await round();
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(2);
  });

  it("treats every account as busy while an instance names no account or the runtime fails", async () => {
    instances = [instance(undefined, "running")];
    await round();
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(2);

    instances = [];
    runtime.list.mockRejectedValue(new Error("socket proxy down"));
    now += 31_000;
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(3);
  });

  it("asks again after forget, e.g. when a bot was started", async () => {
    await round();
    idle.forget();
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(2);
  });

  it("does not keep an answer to a query that started before forget", async () => {
    let answer: (stats: unknown) => void = () => undefined;
    broker.stats.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await idle.broker.positions(c, "1001");
    await idle.broker.pendingOrders(c, "1001");
    const pending = idle.broker.stats(c, "1001");
    idle.forget();
    answer({ balance: 1, equity: 1 });
    await pending;
    await round();
    expect(broker.stats).toHaveBeenCalledTimes(2);
  });

  it("reuses deals by the start of the range and cuts them to its end", async () => {
    await round();
    const from = "2026-11-03T00:00:00.000Z";
    await idle.broker.deals(c, "1001", from, "2026-11-03T09:00:00.000Z");
    const later = await idle.broker.deals(c, "1001", from, "2026-11-03T08:00:00.000Z");
    expect(later.map((d) => d.id)).toEqual(["d1"]);
    expect(broker.deals).toHaveBeenCalledTimes(1);

    await idle.broker.deals(c, "1001", "2026-10-01T00:00:00.000Z", "2026-11-03T09:00:00.000Z");
    expect(broker.deals).toHaveBeenCalledTimes(2);
  });

  it("passes trading actions through", async () => {
    await idle.broker.closePosition(c, "1001", "p1");
    expect(broker.closePosition).toHaveBeenCalledWith(c, "1001", "p1");
  });
});
