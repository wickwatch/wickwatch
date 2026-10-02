import {
  AdapterError,
  buildInstanceDetail,
  readLabels,
  type InstanceDetail,
  type InstanceDetailInput,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { findAccount, type AccountDirectory, type AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { brokerErrorCode } from "./broker-error";
import type { DealHistory } from "./deal-history";
import type { LogTracker } from "./log-tracker";
import type { MarketHoursCache } from "./market-hours";
import { loadOverrides } from "./overrides";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What loading an instance's detail needs; built once, used by the REST route and the MCP tool. */
export interface InstanceDetailDeps {
  adapters: Adapters;
  accounts: AccountDirectory;
  db: Db;
  labelPrefix: string;
  logTracker: LogTracker;
  history: DealHistory;
  marketHours?: MarketHoursCache;
}

export async function loadInstanceDetail(
  { adapters, accounts: directory, db, labelPrefix, logTracker, history, marketHours }: InstanceDetailDeps,
  ref: string,
  /** Days back, or everything since the instance's first deal. */
  range: number | "all",
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<InstanceDetail> {
  const allInstances = await adapters.runtime.list();
  const instance = allInstances.find((i) => i.ref === ref);
  if (!instance) throw new AdapterError("not_found", `Unknown instance ${ref}`);

  const from = range === "all" ? history.cutoff() : new Date(now.getTime() - range * DAY_MS);
  const number = readLabels(labelPrefix, instance.labels).account;
  const entry = number ? await findAccount(directory, number) : undefined;

  const [logs, account, overrides] = await Promise.all([
    logTracker.read([instance]),
    entry ? brokerData(adapters, history, entry, from, now, range === "all", log) : Promise.resolve(undefined),
    loadOverrides(db, adapters.broker.id),
  ]);
  const lastLog = logs.lastLines.get(ref);
  const logState = logs.states.get(ref);
  const detail = buildInstanceDetail({
    time: now,
    from,
    fromFirstTrade: range === "all",
    labelPrefix,
    instance,
    allInstances,
    overrides,
    ...(lastLog ? { lastLog } : {}),
    ...(logState ? { logState } : {}),
    ...(account ? { account } : {}),
  });
  if (!marketHours || !entry) return detail;
  const [withHours = detail.instance] = marketHours.attach([detail.instance], [entry]);
  return { ...detail, instance: withHours };
}

async function brokerData(
  { broker }: Adapters,
  history: DealHistory,
  entry: AccountEntry,
  from: Date,
  now: Date,
  all: boolean,
  log: FastifyBaseLogger,
): Promise<NonNullable<InstanceDetailInput["account"]>> {
  const base = { number: entry.number, displayName: entry.displayName, currency: entry.currency };
  try {
    const c = await entry.credentials();
    const [positions, pendingOrders, recent, older, balance] = await Promise.all([
      broker.positions(c, entry.number),
      broker.capabilities().pendingOrders ? broker.pendingOrders(c, entry.number) : Promise.resolve([]),
      broker.deals(c, entry.number, from.toISOString(), now.toISOString()),
      // Only "all" waits for the older history; the other ranges take it once it is there.
      all ? history.load(entry).catch(() => undefined) : Promise.resolve(history.peek(entry)),
      // Only for the risk in % of the balance; without it the page still shows everything else.
      broker.stats(c, entry.number).then(
        (stats) => stats.balance,
        () => undefined,
      ),
    ]);
    const deals = all && older ? [...older, ...recent] : recent;
    return {
      ...base,
      data: { positions, pendingOrders, deals },
      ...(older ? { history: older } : {}),
      ...(balance !== undefined ? { balance } : {}),
    };
  } catch (error) {
    return { ...base, error: brokerErrorCode(error, entry.number, log) };
  }
}
