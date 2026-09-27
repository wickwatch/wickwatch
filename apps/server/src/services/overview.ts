import {
  buildOverview,
  isAdapterError,
  type AccountSnapshot,
  type LogLine,
  type Overview,
  type RuntimeAdapter,
  type RuntimeInstance,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory, AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Queries runtime and broker in parallel and builds the overview. Failures per account become alerts. */
export async function loadOverview(
  adapters: Adapters,
  directory: AccountDirectory,
  labelPrefix: string,
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<Overview> {
  // Day boundary in UTC until accounts carry their own reset time and time zone.
  const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const [instances, entries] = await Promise.all([adapters.runtime.list(), directory.list()]);
  const [lastLogs, accounts] = await Promise.all([
    lastLogLines(adapters.runtime, instances),
    Promise.all(entries.map((entry) => snapshot(adapters, entry, dayStart, now, log))),
  ]);
  return buildOverview({ time: now, labelPrefix, instances, lastLogs, accounts });
}

async function snapshot(
  { broker }: Adapters,
  entry: AccountEntry,
  dayStart: Date,
  now: Date,
  log: FastifyBaseLogger,
): Promise<AccountSnapshot> {
  const base = {
    number: entry.number,
    displayName: entry.displayName,
    ...(entry.credentialLabel ? { credentialLabel: entry.credentialLabel } : {}),
  };
  try {
    const c = await entry.credentials();
    const [brokerAccounts, stats, positions, dealsToday] = await Promise.all([
      broker.accounts(c),
      broker.stats(c, entry.number),
      broker.positions(c, entry.number),
      broker.deals(c, entry.number, dayStart.toISOString(), now.toISOString()),
    ]);
    const info = brokerAccounts.find((a) => a.number === entry.number);
    return {
      ...base,
      ...(info ? { broker: info.broker, currency: info.currency } : {}),
      data: { stats, positions, dealsToday },
    };
  } catch (error) {
    if (!isAdapterError(error)) log.error({ err: error, account: entry.number }, "Broker query failed");
    return { ...base, error: isAdapterError(error) ? error.code : "unavailable" };
  }
}

async function lastLogLines(runtime: RuntimeAdapter, instances: RuntimeInstance[]): Promise<Map<string, LogLine>> {
  const entries = await Promise.all(
    instances.map(async (instance) => {
      let last: LogLine | undefined;
      try {
        for await (const line of runtime.logs(instance.ref, { tail: 1 })) last = line;
      } catch {
        // A missing log is not worth failing the overview for.
      }
      return [instance.ref, last] as const;
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, LogLine] => e[1] !== undefined));
}
