import { describe, expect, it } from "vitest";
import {
  attributeDeals,
  buildAccountDetail,
  buildLabels,
  buildOverview,
  overrideKey,
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

describe("trades of no instance on the account page", () => {
  // Two bots on one account and symbol: a trade opened by hand carries no label of theirs, so the rules cannot place it.
  const instances = [instance("m30", "111", "running"), instance("h1", "111", "stopped")];
  const byHand: Deal = { ...deal("", 60), id: "d-hand", positionId: "p-hand" };
  const input = { instances, labelPrefix: "ww" };

  it("lists every deal of the account, oldest first, with its instance where the rules know one", () => {
    const later = { ...deal("m30", 20), positionId: "p-bot", time: "2026-09-25T11:00:00.000Z" };
    expect(attributeDeals(input, "111", [later, byHand]).map((d) => [d.id, d.instance, d.manual])).toEqual([
      ["d-hand", undefined, undefined],
      ["d-m30-20", "m30", undefined],
    ]);
  });

  it("gives a deal attributed by hand to its instance and marks it, also when set to no instance", () => {
    const to = (owner: string | null) =>
      attributeDeals({ ...input, overrides: new Map([[overrideKey("111", "p-hand"), owner]]) }, "111", [byHand])[0];
    expect(to("h1")).toMatchObject({ instance: "h1", manual: true });
    expect(to(null)).toMatchObject({ manual: true });
    expect(to(null)).not.toHaveProperty("instance");
  });

  it("marks an open position attributed by hand", () => {
    const open = { ...position("", 5), id: "p-hand" };
    const detail = buildAccountDetail(
      {
        ...input,
        time,
        lastLogs: new Map(),
        overrides: new Map([[overrideKey("111", "p-hand"), "h1"]]),
        accounts: [
          {
            number: "111",
            displayName: "A",
            data: {
              stats: { balance: 1000, equity: 1005, time: time.toISOString() },
              positions: [open, position("m30", 1)],
              dealsToday: [],
            },
          },
        ],
      },
      "111",
    );
    expect(detail?.positions.map((p) => [p.id, p.instance, p.manual])).toEqual([
      ["p-hand", "h1", true],
      ["p-m30", "m30", undefined],
    ]);
  });
});
