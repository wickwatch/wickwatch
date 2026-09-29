import type { AdapterErrorCode } from "./errors";
import { createAttributor, type AttributionOverrides, type TradeItem } from "./attribution";
import { readLabels } from "./labels";
import { positionItem, summarizeInstance } from "./overview";
import type {
  Deal,
  InstanceDetail,
  InstanceLogState,
  LogLine,
  PendingOrder,
  Position,
  RuntimeInstance,
} from "./schemas";
import { toIsoTime } from "./schemas";
import { dealResult, dealStats } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstanceDetailInput {
  time: Date;
  from: Date;
  /** The range starts at the instance's first trade instead of `from` (the "all" range). */
  fromFirstTrade?: boolean;
  labelPrefix: string;
  instance: RuntimeInstance;
  /** All instances, so trades can be attributed (e.g. "only instance on this account and symbol"). */
  allInstances?: RuntimeInstance[];
  overrides?: AttributionOverrides;
  lastLog?: LogLine;
  /** What the instance's log says (lost connection, crashes). */
  logState?: InstanceLogState;
  account?: {
    number: string;
    displayName: string;
    currency?: string;
    /** Broker data of the whole account; attributed to the instance here (see attribution.ts). */
    data?: { positions: Position[]; pendingOrders: PendingOrder[]; deals: Deal[] };
    /** Older deals of the account, oldest first, if loaded; only used to find the instance's first trade. */
    history?: Deal[];
    error?: AdapterErrorCode;
  };
}

/** Everything the detail view shows for one instance. Pure: no I/O. */
export function buildInstanceDetail(input: InstanceDetailInput): InstanceDetail {
  const { instance, account, time } = input;
  const dayStart = Math.floor(time.getTime() / DAY_MS) * DAY_MS;
  const data = account?.data;

  const attributor = createAttributor(input.allInstances ?? [instance], input.labelPrefix, input.overrides);
  const summary = summarizeInstance(
    instance,
    input.labelPrefix,
    data
      ? { positions: data.positions, dealsToday: data.deals.filter((d) => Date.parse(d.time) >= dayStart) }
      : undefined,
    input.lastLog,
    attributor,
    input.logState,
  );
  const accountNumber = readLabels(input.labelPrefix, instance.labels).account;
  const mine = <T>(items: T[] | undefined, item: (x: T) => TradeItem) =>
    items?.filter((i) => accountNumber !== undefined && attributor.owner(accountNumber, item(i)) === summary.name) ??
    [];
  /** Removed from this instance by hand; shown separately so they can be restored. */
  const excluded = <T>(items: T[] | undefined, item: (x: T) => TradeItem) =>
    items?.filter(
      (i) =>
        accountNumber !== undefined &&
        attributor.isExcluded(accountNumber, item(i)) &&
        attributor.automaticOwner(accountNumber, item(i)) === summary.name,
    ) ?? [];
  const asItem = (d: Deal): TradeItem => d;
  const orderItem = (o: PendingOrder): TradeItem => ({ label: o.label, symbol: o.symbol });
  const byTime = (a: Deal, b: Deal) => a.time.localeCompare(b.time);
  const own = mine(data?.deals, asItem).sort(byTime);
  // The first deal that changed the P&L; deals before it (e.g. openings without costs) add nothing.
  const first = [...mine(account?.history, asItem), ...own].find((d) => dealResult(d) !== 0)?.time;
  const from = input.fromFirstTrade && first ? new Date(first) : input.from;
  const deals = input.fromFirstTrade && first ? own.filter((d) => d.time >= first) : own;

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
    positions: mine(data?.positions, positionItem),
    pendingOrders: mine(data?.pendingOrders, orderItem),
    excludedPositions: excluded(data?.positions, positionItem),
    excludedDeals: excluded(data?.deals, asItem).sort(byTime),
    deals,
    stats: dealStats(deals),
    range: { from: toIsoTime(from), to: toIsoTime(time) },
    ...(first ? { firstTradeAt: toIsoTime(new Date(first)) } : {}),
  };
}
