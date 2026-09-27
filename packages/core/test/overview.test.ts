import { describe, expect, it } from "vitest";
import { buildLabels, buildOverview, type Deal, type Position, type RuntimeInstance } from "../src";

const time = new Date("2026-09-25T12:00:00.000Z");
const instance = (name: string, account: string, status: RuntimeInstance["status"]): RuntimeInstance => ({
  ref: `ww-${name}`,
  labels: buildLabels("ww", { instance: name, account, symbol: "GER40", period: "M5" }),
  status,
  restartCount: status === "error" ? 3 : 0,
  ...(status === "running" ? { startedAt: "2026-09-24T12:00:00.000Z" } : {}),
});
const position = (label: string, pnl: number): Position => ({
  id: `p-${label}`,
  symbol: "GER40",
  side: "buy",
  volume: 1,
  entry: 19400,
  pnl,
  label,
  openedAt: "2026-09-25T10:00:00.000Z",
});
const deal = (label: string, pnl: number): Deal => ({
  id: `d-${label}-${pnl}`,
  positionId: "x",
  symbol: "GER40",
  side: "sell",
  volume: 1,
  price: 19410,
  pnl,
  commission: -3,
  label,
  time: "2026-09-25T09:00:00.000Z",
});

describe("buildOverview", () => {
  const overview = buildOverview({
    time,
    labelPrefix: "ww",
    instances: [
      instance("alpha", "111", "running"),
      instance("beta", "111", "error"),
      instance("gamma", "222", "stopped"),
    ],
    lastLogs: new Map([["ww-beta", { time: "2026-09-25T11:59:00.000Z", text: "Login failed", level: "error" }]]),
    accounts: [
      {
        number: "111",
        displayName: "Main",
        currency: "USD",
        data: {
          stats: { balance: 1000, equity: 1050, time: "2026-09-25T12:00:00.000Z" },
          positions: [position("alpha", 50)],
          dealsToday: [deal("alpha", 20), deal("other", 10)],
        },
      },
      { number: "222", displayName: "Second", error: "auth_failed" },
      { number: "333", displayName: "Empty" },
    ],
  });

  it("attributes positions and deals to instances by label", () => {
    const alpha = overview.instances.find((i) => i.name === "alpha");
    expect(alpha).toMatchObject({ ref: "ww-alpha", account: "111", symbol: "GER40", openPositions: 1, dayPnl: 67 });
    expect(overview.instances.find((i) => i.name === "beta")?.lastLog?.text).toBe("Login failed");
  });

  it("summarises accounts with state and day P&L including unattributed deals", () => {
    expect(overview.accounts.map((a) => [a.number, a.state, a.dayPnl])).toEqual([
      ["111", "attention", 74],
      ["222", "error", undefined],
      ["333", "idle", undefined],
    ]);
    expect(overview.accounts[0]).toMatchObject({ balance: 1000, equity: 1050, instances: { total: 2, running: 1 } });
  });

  it("raises alerts for unreachable accounts, errors and stopped instances", () => {
    expect(overview.alerts).toEqual([
      { level: "error", code: "account_error", subject: "222", params: { reason: "auth_failed" } },
      { level: "error", code: "instance_error", subject: "beta", params: { restarts: 3, detail: "Login failed" } },
      { level: "warning", code: "instance_stopped", subject: "gamma", params: {} },
    ]);
  });
});
