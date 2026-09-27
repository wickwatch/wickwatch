import type { AdapterErrorCode } from "./errors";
import { summarizeInstance } from "./overview";
import type { Deal, InstanceDetail, LogLine, PendingOrder, Position, RuntimeInstance } from "./schemas";
import { toIsoTime } from "./schemas";
import { dealStats } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstanceDetailInput {
  time: Date;
  from: Date;
  labelPrefix: string;
  instance: RuntimeInstance;
  lastLog?: LogLine;
  account?: {
    number: string;
    displayName: string;
    currency?: string;
    /** Broker data of the whole account; filtered here by the instance's order label. */
    data?: { positions: Position[]; pendingOrders: PendingOrder[]; deals: Deal[] };
    error?: AdapterErrorCode;
  };
}

/** Everything the detail view shows for one instance. Pure: no I/O. */
export function buildInstanceDetail(input: InstanceDetailInput): InstanceDetail {
  const { instance, account, time } = input;
  const dayStart = Math.floor(time.getTime() / DAY_MS) * DAY_MS;
  const data = account?.data;

  const summary = summarizeInstance(
    instance,
    input.labelPrefix,
    data
      ? { positions: data.positions, dealsToday: data.deals.filter((d) => Date.parse(d.time) >= dayStart) }
      : undefined,
    input.lastLog,
  );
  const mine = <T extends { label?: string }>(items: T[] | undefined) =>
    items?.filter((i) => i.label === summary.name) ?? [];
  const deals = mine(data?.deals).sort((a, b) => a.time.localeCompare(b.time));

  return {
    time: toIsoTime(time),
    instance: { ...summary, labels: { ...instance.labels }, ...(instance.image ? { image: instance.image } : {}) },
    ...(account
      ? {
          account: {
            number: account.number,
            displayName: account.displayName,
            ...(account.currency ? { currency: account.currency } : {}),
          },
        }
      : {}),
    ...(account?.error ? { brokerError: account.error } : {}),
    positions: mine(data?.positions),
    pendingOrders: mine(data?.pendingOrders),
    deals,
    stats: dealStats(deals),
    range: { from: toIsoTime(input.from), to: toIsoTime(time) },
  };
}
