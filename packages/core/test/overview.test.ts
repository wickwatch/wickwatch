import { describe, expect, it } from "vitest";
import {
  buildLabels,
  buildOverview,
  type ChallengeEvaluation,
  type Deal,
  type Position,
  type RuleResult,
  type RuntimeInstance,
} from "../src";

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

  it("warns about a server clock that is off, not about a small offset", () => {
    const base = { time, labelPrefix: "ww", instances: [], lastLogs: new Map(), accounts: [] };
    expect(buildOverview({ ...base, clockOffsetMs: 1500 }).alerts).toEqual([]);
    expect(buildOverview({ ...base, clockOffsetMs: -3240 }).alerts).toEqual([
      { level: "warning", code: "host_clock", subject: "host", params: { offset: -3.2 } },
    ]);
  });

  it("raises no alert for an instance stopped on purpose, not even for a lost connection in its log", () => {
    const result = buildOverview({
      time,
      labelPrefix: "ww",
      instances: [instance("gamma", "111", "stopped"), instance("delta", "111", "stopped")],
      lastLogs: new Map(),
      logStates: new Map([["ww-gamma", { connectionLostSince: "2026-09-25T11:58:00.000Z" }]]),
      accounts: [],
      stoppedByUser: new Set(["ww-gamma"]),
    });
    expect(result.instances.map((i) => [i.name, i.stoppedByUser])).toEqual([
      ["gamma", true],
      ["delta", undefined],
    ]);
    expect(result.alerts).toEqual([{ level: "warning", code: "instance_stopped", subject: "delta", params: {} }]);
  });

  it("marks running instances that lost their broker connection and raises a warning", () => {
    const since = "2026-09-25T11:58:00.000Z";
    const result = buildOverview({
      time,
      labelPrefix: "ww",
      instances: [instance("alpha", "111", "running"), instance("gamma", "111", "stopped")],
      lastLogs: new Map(),
      logStates: new Map([
        ["ww-alpha", { connectionLostSince: since }],
        ["ww-gamma", { connectionLostSince: since }],
      ]),
      accounts: [],
    });
    expect(result.instances.map((i) => [i.name, i.connectionLostSince])).toEqual([
      ["alpha", since],
      ["gamma", undefined],
    ]);
    expect(result.alerts).toContainEqual({
      level: "warning",
      code: "instance_disconnected",
      subject: "alpha",
      params: { since },
    });
    expect(result.alerts.filter((a) => a.subject === "gamma").map((a) => a.code)).toEqual(["instance_stopped"]);
  });

  it("raises an error for a running bot that threw within the last hour", () => {
    const crashes = (lastAt: string) => ({ count: 3, lastAt, lastText: "Error | Crashed in OnBar event with X: boom" });
    const result = buildOverview({
      time,
      labelPrefix: "ww",
      instances: [instance("alpha", "111", "running"), instance("delta", "111", "running")],
      lastLogs: new Map(),
      logStates: new Map([
        ["ww-alpha", { crashes: crashes("2026-09-25T11:30:00.000Z") }],
        ["ww-delta", { crashes: crashes("2026-09-25T10:30:00.000Z") }],
      ]),
      accounts: [],
    });
    expect(result.instances.map((i) => i.crashes?.count)).toEqual([3, 3]);
    expect(result.alerts).toEqual([
      {
        level: "error",
        code: "instance_crashed",
        subject: "alpha",
        params: { count: 3, last: "2026-09-25T11:30:00.000Z", detail: "Error | Crashed in OnBar event with X: boom" },
      },
    ]);
  });

  it("warns about an inactive account next to a loss limit, and only reports the breach once it is closed", () => {
    const rule = (id: RuleResult["id"], status: RuleResult["status"], value: number, limit: number): RuleResult => ({
      id,
      status,
      value,
      limit,
      usage: value / limit,
      unit: id === "inactivity" ? "days" : "percent",
    });
    const alerts = (status: ChallengeEvaluation["status"], rules: RuleResult[]) =>
      buildOverview({
        time,
        labelPrefix: "ww",
        instances: [],
        lastLogs: new Map(),
        accounts: [
          {
            number: "111",
            displayName: "Main",
            challenge: { name: "Prop", day: 20, status, rules, tradingDayStart: "2026-09-25T00:00:00.000Z" },
          },
        ],
      }).alerts;

    expect(alerts("warning", [rule("dailyLoss", "warning", 3, 5), rule("inactivity", "danger", 17, 21)])).toEqual([
      { level: "warning", code: "challenge_inactive", subject: "111", params: { days: 17, limit: 21 } },
      { level: "warning", code: "challenge_limit", subject: "111", params: { rule: "dailyLoss", used: 60 } },
    ]);
    expect(alerts("running", [rule("inactivity", "ok", 10, 21)])).toEqual([]);
    expect(alerts("breached", [rule("inactivity", "breached", 21, 21)])).toEqual([
      { level: "error", code: "challenge_breached", subject: "111", params: { rule: "inactivity" } },
    ]);
  });
});
