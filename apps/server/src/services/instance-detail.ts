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

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadInstanceDetail(
  adapters: Adapters,
  directory: AccountDirectory,
  labelPrefix: string,
  ref: string,
  days: number,
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<InstanceDetail> {
  const allInstances = await adapters.runtime.list();
  const instance = allInstances.find((i) => i.ref === ref);
  if (!instance) throw new AdapterError("not_found", `Unknown instance ${ref}`);

  const from = new Date(now.getTime() - days * DAY_MS);
  const number = readLabels(labelPrefix, instance.labels).account;
  const entry = number ? await findAccount(directory, number) : undefined;

  const [lastLog, account] = await Promise.all([
    lastLine(adapters, ref),
    entry ? brokerData(adapters, entry, from, now, log) : Promise.resolve(undefined),
  ]);
  return buildInstanceDetail({
    time: now,
    from,
    labelPrefix,
    instance,
    allInstances,
    ...(lastLog ? { lastLog } : {}),
    ...(account ? { account } : {}),
  });
}

async function brokerData(
  { broker }: Adapters,
  entry: NonNullable<Awaited<ReturnType<typeof findAccount>>>,
  from: Date,
  now: Date,
  log: FastifyBaseLogger,
): Promise<NonNullable<InstanceDetailInput["account"]>> {
  const base = { number: entry.number, displayName: entry.displayName, currency: entry.currency };
  try {
    const c = await entry.credentials();
    const [positions, pendingOrders, deals] = await Promise.all([
      broker.positions(c, entry.number),
      broker.capabilities().pendingOrders ? broker.pendingOrders(c, entry.number) : Promise.resolve([]),
      broker.deals(c, entry.number, from.toISOString(), now.toISOString()),
    ]);
    return { ...base, data: { positions, pendingOrders, deals } };
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
