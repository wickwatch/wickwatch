import type { AdapterErrorCode } from "./errors";
import { createAttributor, type AttributionOverrides, type Attributor, type TradeItem } from "./attribution";
import { readLabels } from "./labels";
import type {
  AccountStats,
  AccountSummary,
  Alert,
  ChallengeEvaluation,
  Deal,
  InstanceSummary,
  LogLine,
  Overview,
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
  /** Broker data; missing when the query failed. */
  data?: { stats: AccountStats; positions: Position[]; dealsToday: Deal[] };
  error?: AdapterErrorCode;
  challenge?: ChallengeEvaluation;
}

export interface OverviewInput {
  time: Date;
  labelPrefix: string;
  instances: RuntimeInstance[];
  lastLogs: ReadonlyMap<string, LogLine>;
  accounts: AccountSnapshot[];
  /** Manual attribution per position, see attribution.ts. */
  overrides?: AttributionOverrides;
}

const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));

/** Positions are overridden by their id; deals carry `positionId` themselves. */
export const positionItem = (p: Position): TradeItem => ({ label: p.label, symbol: p.symbol, positionId: p.id });

/** One instance with its positions and today's P&L; shared by the overview and the detail view. */
export function summarizeInstance(
  instance: RuntimeInstance,
  labelPrefix: string,
  broker: { positions: Position[]; dealsToday: Deal[] } | undefined,
  lastLog: LogLine | undefined,
  attributor: Attributor,
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
  };
}

/** Combines runtime and broker data into the overview. Pure: no I/O. */
export function buildOverview(input: OverviewInput): Overview {
  const byNumber = new Map(input.accounts.map((a) => [a.number, a]));

  const attributor = createAttributor(input.instances, input.labelPrefix, input.overrides);
  const instances = input.instances.map((instance) => {
    const account = readLabels(input.labelPrefix, instance.labels).account;
    const data = account ? byNumber.get(account)?.data : undefined;
    return summarizeInstance(instance, input.labelPrefix, data, input.lastLogs.get(instance.ref), attributor);
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

  return { time: toIsoTime(input.time), accounts, instances, alerts: alerts(instances, input.accounts, attributor) };
}

function accountState(account: AccountSnapshot, total: number, running: number): AccountSummary["state"] {
  if (account.error) return "error";
  if (total === 0) return "idle";
  if (running === total) return "running";
  return running === 0 ? "stopped" : "attention";
}

function alerts(instances: InstanceSummary[], accounts: AccountSnapshot[], attributor: Attributor): Alert[] {
  const result: Alert[] = [];
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
      result.push({ level: "warning", code: "instance_stopped", subject: i.name, params: {} });
    }
  }
  return result;
}
