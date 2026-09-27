import type { AdapterErrorCode } from "./errors";
import { readLabels } from "./labels";
import type {
  AccountStats,
  AccountSummary,
  Alert,
  Deal,
  InstanceSummary,
  LogLine,
  Overview,
  Position,
  RuntimeInstance,
} from "./schemas";
import { toIsoTime } from "./schemas";

export interface AccountSnapshot {
  number: string;
  displayName: string;
  credentialLabel?: string;
  broker?: string;
  currency?: string;
  /** Broker data; missing when the query failed. */
  data?: { stats: AccountStats; positions: Position[]; dealsToday: Deal[] };
  error?: AdapterErrorCode;
}

export interface OverviewInput {
  time: Date;
  labelPrefix: string;
  instances: RuntimeInstance[];
  lastLogs: ReadonlyMap<string, LogLine>;
  accounts: AccountSnapshot[];
}

const dealResult = (deal: Deal) => deal.pnl + (deal.commission ?? 0) + (deal.swap ?? 0);
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

/** Combines runtime and broker data into the overview. Pure: no I/O. */
export function buildOverview(input: OverviewInput): Overview {
  const byNumber = new Map(input.accounts.map((a) => [a.number, a]));

  const instances = input.instances.map((instance): InstanceSummary => {
    const labels = readLabels(input.labelPrefix, instance.labels);
    const name = labels.instance ?? instance.ref;
    const data = labels.account ? byNumber.get(labels.account)?.data : undefined;
    const positions = data?.positions.filter((p) => p.label === name) ?? [];
    const deals = data?.dealsToday.filter((d) => d.label === name) ?? [];
    const lastLog = input.lastLogs.get(instance.ref);
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
      ...(data
        ? {
            balance: data.stats.balance,
            equity: data.stats.equity,
            dayPnl: sum([...data.dealsToday.map(dealResult), ...data.positions.map((p) => p.pnl)]),
          }
        : {}),
    };
  });

  return { time: toIsoTime(input.time), accounts, instances, alerts: alerts(instances, input.accounts) };
}

function accountState(account: AccountSnapshot, total: number, running: number): AccountSummary["state"] {
  if (account.error) return "error";
  if (total === 0) return "idle";
  if (running === total) return "running";
  return running === 0 ? "stopped" : "attention";
}

function alerts(instances: InstanceSummary[], accounts: AccountSnapshot[]): Alert[] {
  const result: Alert[] = [];
  for (const account of accounts) {
    if (account.error) {
      result.push({
        level: "error",
        code: "account_error",
        subject: account.number,
        params: { reason: account.error },
      });
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
