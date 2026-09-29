import {
  AdapterError,
  buildInstanceDetail,
  isAdapterError,
  readLabels,
  type InstanceDetail,
  type InstanceDetailInput,
  type LogLine,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { findAccount, type AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import type { DealHistory } from "./deal-history";
import type { LogTracker } from "./log-tracker";
import { loadOverrides } from "./overrides";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadInstanceDetail(
  adapters: Adapters,
  directory: AccountDirectory,
  db: Db,
  labelPrefix: string,
  logTracker: LogTracker,
  history: DealHistory,
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

  const [lastLog, logStates, account, overrides] = await Promise.all([
    lastLine(adapters, ref),
    logTracker.states([instance]),
    entry ? brokerData(adapters, history, entry, from, now, range === "all", log) : Promise.resolve(undefined),
    loadOverrides(db),
  ]);
  const logState = logStates.get(ref);
  return buildInstanceDetail({
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
}

async function brokerData(
  { broker }: Adapters,
  history: DealHistory,
  entry: NonNullable<Awaited<ReturnType<typeof findAccount>>>,
  from: Date,
  now: Date,
  all: boolean,
  log: FastifyBaseLogger,
): Promise<NonNullable<InstanceDetailInput["account"]>> {
  const base = { number: entry.number, displayName: entry.displayName, currency: entry.currency };
  try {
    const c = await entry.credentials();
    const [positions, pendingOrders, recent, older] = await Promise.all([
      broker.positions(c, entry.number),
      broker.capabilities().pendingOrders ? broker.pendingOrders(c, entry.number) : Promise.resolve([]),
      broker.deals(c, entry.number, from.toISOString(), now.toISOString()),
      // Only "all" waits for the older history; the other ranges take it once it is there.
      all ? history.load(entry).catch(() => undefined) : Promise.resolve(history.peek(entry)),
    ]);
    const deals = all && older ? [...older, ...recent] : recent;
    return { ...base, data: { positions, pendingOrders, deals }, ...(older ? { history: older } : {}) };
  } catch (error) {
    if (!isAdapterError(error)) log.error({ err: error, account: entry.number }, "Broker query failed");
    return { ...base, error: isAdapterError(error) ? error.code : "unavailable" };
  }
}

async function lastLine({ runtime }: Adapters, ref: string): Promise<LogLine | undefined> {
  let last: LogLine | undefined;
  try {
    for await (const line of runtime.logs(ref, { tail: 1 })) last = line;
  } catch {
    // Logs are optional for the detail view.
  }
  return last;
}
