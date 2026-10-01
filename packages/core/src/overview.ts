import type { AdapterErrorCode } from "./errors";
import { createAttributor, type AttributionOverrides, type Attributor, type TradeItem } from "./attribution";
import { readLabels } from "./labels";
import type {
  AccountDetail,
  AccountStats,
  AccountSummary,
  Alert,
  ChallengeEvaluation,
  Deal,
  InstanceSummary,
  InstanceLogState,
  LogLine,
  Overview,
  PendingOrder,
  Position,
  RuntimeInstance,
} from "./schemas";
import { toIsoTime } from "./schemas";
import { dealResult, round2 } from "./stats";

export interface AccountSnapshot {
  number: string;
  displayName: string;
  credentialLabel?: string;
  broker?: string;
  currency?: string;
  /** Broker data; missing when the query failed. `pendingOrders` only when the broker supports them. */
  data?: { stats: AccountStats; positions: Position[]; dealsToday: Deal[]; pendingOrders?: PendingOrder[] };
  error?: AdapterErrorCode;
  challenge?: ChallengeEvaluation;
  /** The loss guard stopped the account in the current trading day. */
  guardTripped?: { at: string; rule: string };
}

export interface OverviewInput {
  time: Date;
  labelPrefix: string;
  instances: RuntimeInstance[];
  lastLogs: ReadonlyMap<string, LogLine>;
  /** What each instance's log says (lost connection, crashes), by runtime ref. */
  logStates?: ReadonlyMap<string, InstanceLogState>;
  accounts: AccountSnapshot[];
  /** Manual attribution per position, see attribution.ts. */
  overrides?: AttributionOverrides;
  /** Measured offset of the server clock (ms), when the server checks it. */
  clockOffsetMs?: number;
  /** Runtime refs of instances stopped on purpose through wickwatch. */
  stoppedByUser?: ReadonlySet<string>;
}

const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));

/** Positions are overridden by their id; deals carry `positionId` themselves. */
export const positionItem = (p: Position): TradeItem => ({ label: p.label, symbol: p.symbol, positionId: p.id });
/** Pending orders have no position yet, so no manual override applies to them. */
export const orderItem = (o: PendingOrder): TradeItem => ({ label: o.label, symbol: o.symbol });

/** One instance with its positions and today's P&L; shared by the overview and the detail view. */
export function summarizeInstance(
  instance: RuntimeInstance,
  labelPrefix: string,
  broker: { positions: Position[]; dealsToday: Deal[] } | undefined,
  lastLog: LogLine | undefined,
  attributor: Attributor,
  logState: InstanceLogState = {},
): InstanceSummary {
  const labels = readLabels(labelPrefix, instance.labels);
  const name = labels.instance ?? instance.ref;
  const owns = (item: TradeItem) => labels.account !== undefined && attributor.owner(labels.account, item) === name;
  const positions = broker?.positions.filter((p) => owns(positionItem(p))) ?? [];
  const deals = broker?.dealsToday.filter(owns) ?? [];
  return {
    ref: instance.ref,
    name,
    status: instance.status,
    restartCount: instance.restartCount,
    openPositions: positions.length,
    dayPnl: sum([...deals.map(dealResult), ...positions.map((p) => p.pnl)]),
    ...(labels.account ? { account: labels.account } : {}),
    ...(labels.symbol ? { symbol: labels.symbol } : {}),
    ...(labels.period ? { period: labels.period } : {}),
    ...(instance.startedAt ? { startedAt: instance.startedAt } : {}),
    ...(lastLog ? { lastLog } : {}),
    // A stopped instance has no connection to lose.
    ...(logState.connectionLostSince && instance.status === "running"
      ? { connectionLostSince: logState.connectionLostSince }
      : {}),
    ...(logState.crashes ? { crashes: logState.crashes } : {}),
  };
}

/** Combines runtime and broker data into the overview. Pure: no I/O. */
export function buildOverview(input: OverviewInput): Overview {
  return overviewWith(input, createAttributor(input.instances, input.labelPrefix, input.overrides));
}

function overviewWith(input: OverviewInput, attributor: Attributor): Overview {
  const byNumber = new Map(input.accounts.map((a) => [a.number, a]));

  const instances = input.instances.map((instance) => {
    const account = readLabels(input.labelPrefix, instance.labels).account;
    const data = account ? byNumber.get(account)?.data : undefined;
    const summary = summarizeInstance(
      instance,
      input.labelPrefix,
      data,
      input.lastLogs.get(instance.ref),
      attributor,
      input.logStates?.get(instance.ref),
    );
    return input.stoppedByUser?.has(instance.ref) ? { ...summary, stoppedByUser: true } : summary;
  });

  const accounts = input.accounts.map((account): AccountSummary => {
    const own = instances.filter((i) => i.account === account.number);
    const running = own.filter((i) => i.status === "running").length;
    const { data } = account;
    return {
      number: account.number,
      displayName: account.displayName,
      state: accountState(account, own.length, running),
      openPositions: data?.positions.length ?? 0,
      ...(data?.pendingOrders ? { pendingOrders: data.pendingOrders.length } : {}),
      instances: { total: own.length, running },
      ...(account.credentialLabel ? { credentialLabel: account.credentialLabel } : {}),
      ...(account.broker ? { broker: account.broker } : {}),
      ...(account.currency ? { currency: account.currency } : {}),
      ...(account.error ? { error: account.error } : {}),
      ...(account.challenge ? { challenge: account.challenge } : {}),
      ...(data
        ? {
            balance: data.stats.balance,
            equity: data.stats.equity,
            dayPnl: sum([...data.dealsToday.map(dealResult), ...data.positions.map((p) => p.pnl)]),
          }
        : {}),
    };
  });

  return {
    time: toIsoTime(input.time),
    accounts,
    instances,
    alerts: alerts(instances, input.accounts, attributor, input.time, input.clockOffsetMs),
  };
}

/**
 * One account for its own page: its summary and instances as in the overview, plus every open position and pending
 * order with the instance it belongs to (same attribution as everywhere). Undefined if the account is not in `input`.
 */
export function buildAccountDetail(input: OverviewInput, number: string): AccountDetail | undefined {
  const attributor = createAttributor(input.instances, input.labelPrefix, input.overrides);
  const overview = overviewWith(input, attributor);
  const account = overview.accounts.find((a) => a.number === number);
  if (!account) return undefined;
  const data = input.accounts.find((a) => a.number === number)?.data;
  const owner = (item: TradeItem) => attributor.owner(number, item);
  const instances = overview.instances.filter((i) => i.account === number);
  const names = new Set([number, ...instances.map((i) => i.name)]);
  return {
    time: overview.time,
    account,
    instances,
    positions: (data?.positions ?? []).map((p) => withInstance(p, owner(positionItem(p)))),
    pendingOrders: (data?.pendingOrders ?? []).map((o) => withInstance(o, owner(orderItem(o)))),
    alerts: overview.alerts.filter((a) => names.has(a.subject)),
  };
}

const withInstance = <T extends object>(item: T, instance: string | undefined): T & { instance?: string } =>
  instance ? { ...item, instance } : item;

function accountState(account: AccountSnapshot, total: number, running: number): AccountSummary["state"] {
  if (account.error) return "error";
  if (total === 0) return "idle";
  if (running === total) return "running";
  return running === 0 ? "stopped" : "attention";
}

/** A crash stays an alert for this long after the latest one, so a bot that keeps failing stays visible. */
export const CRASH_ALERT_MS = 60 * 60 * 1000;
/** A clock further off than this raises an alert and counts as not synced. */
export const CLOCK_TOLERANCE_MS = 2000;

function alerts(
  instances: InstanceSummary[],
  accounts: AccountSnapshot[],
  attributor: Attributor,
  time: Date,
  clockOffsetMs?: number,
): Alert[] {
  const result: Alert[] = [];
  if (clockOffsetMs !== undefined && Math.abs(clockOffsetMs) > CLOCK_TOLERANCE_MS) {
    const offset = Math.round(clockOffsetMs / 100) / 10;
    result.push({ level: "warning", code: "host_clock", subject: "host", params: { offset } });
  }
  for (const problem of attributor.problems) {
    const params = { instances: problem.instances.join(", "), ...(problem.symbol ? { symbol: problem.symbol } : {}) };
    const code = problem.kind === "ambiguous" ? "attribution_ambiguous" : "attribution_invalid";
    result.push({ level: "warning", code, subject: problem.account, params });
  }
  for (const account of accounts) {
    if (account.error) {
      result.push({
        level: "error",
        code: "account_error",
        subject: account.number,
        params: { reason: account.error },
      });
    }
    if (account.guardTripped) {
      const params = { rule: account.guardTripped.rule, since: account.guardTripped.at };
      result.push({ level: "error", code: "challenge_guard", subject: account.number, params });
    }
    const challenge = account.challenge;
    if (!challenge) continue;
    const breached = challenge.rules.find((r) => r.status === "breached");
    const near = challenge.rules
      .filter((r) => r.status === "danger" || r.status === "warning")
      .sort((a, b) => b.usage - a.usage)[0];
    if (breached) {
      result.push({
        level: "error",
        code: "challenge_breached",
        subject: account.number,
        params: { rule: breached.id },
      });
    } else if (near) {
      const params = { rule: near.id, used: Math.round(near.usage * 100) };
      result.push({ level: "warning", code: "challenge_limit", subject: account.number, params });
    } else if (challenge.status === "passed") {
      result.push({ level: "info", code: "challenge_passed", subject: account.number, params: {} });
    }
  }
  for (const i of instances) {
    if (i.status === "error") {
      const params = { restarts: i.restartCount, detail: i.lastLog?.text ?? "" };
      result.push({ level: "error", code: "instance_error", subject: i.name, params });
    } else if (i.status === "stopped") {
      // Stopped through wickwatch on purpose: the user knows (and the loss guard has an alert of its own).
      if (!i.stoppedByUser) result.push({ level: "warning", code: "instance_stopped", subject: i.name, params: {} });
    } else if (i.connectionLostSince) {
      const params = { since: i.connectionLostSince };
      result.push({ level: "warning", code: "instance_disconnected", subject: i.name, params });
    }
    if (i.status === "running" && i.crashes && time.getTime() - Date.parse(i.crashes.lastAt) < CRASH_ALERT_MS) {
      const params = { count: i.crashes.count, last: i.crashes.lastAt, detail: i.crashes.lastText };
      result.push({ level: "error", code: "instance_crashed", subject: i.name, params });
    }
  }
  return result;
}
