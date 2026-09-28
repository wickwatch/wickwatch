import {
  buildOverview,
  isAdapterError,
  profileDay,
  tradingDayStart,
  type ChallengeProfile,
  type AccountSnapshot,
  type LogLine,
  type Overview,
  type RuntimeAdapter,
  type RuntimeInstance,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory, AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import { evaluateForAccount, readProfiles } from "../challenges/store";
import type { Db } from "../db";
import type { LogTracker } from "./log-tracker";
import { guardTripToday } from "./loss-guard";
import { loadOverrides } from "./overrides";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Queries runtime and broker in parallel and builds the overview. Failures per account become alerts. */
export async function loadOverview(
  adapters: Adapters,
  directory: AccountDirectory,
  db: Db,
  labelPrefix: string,
  logTracker: LogTracker,
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<Overview> {
  // "Today" is the UTC day; accounts with a challenge profile also need their own trading day.
  const utcDayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const [instances, entries, profiles, overrides] = await Promise.all([
    adapters.runtime.list(),
    directory.list(),
    readProfiles(db),
    loadOverrides(db),
  ]);
  const [lastLogs, logStates, accounts] = await Promise.all([
    lastLogLines(adapters.runtime, instances),
    logTracker.states(instances),
    Promise.all(entries.map((entry) => snapshot(adapters, db, entry, profiles.get(entry.id), utcDayStart, now, log))),
  ]);
  return buildOverview({ time: now, labelPrefix, instances, lastLogs, logStates, accounts, overrides });
}

async function snapshot(
  { broker }: Adapters,
  db: Db,
  entry: AccountEntry,
  profile: ChallengeProfile | undefined,
  utcDayStart: Date,
  now: Date,
  log: FastifyBaseLogger,
): Promise<AccountSnapshot> {
  const { resetTime, timeZone } = profileDay(profile?.rules ?? {});
  const from = profile
    ? new Date(Math.min(utcDayStart.getTime(), tradingDayStart(now, resetTime, timeZone).getTime()))
    : utcDayStart;
  // Shown even when the broker cannot be asked right now.
  const guardTripped = profile ? await guardTripToday(db, entry.id, profile.rules, now) : undefined;
  const base = {
    number: entry.number,
    displayName: entry.displayName,
    ...(entry.credentialLabel ? { credentialLabel: entry.credentialLabel } : {}),
    ...(guardTripped ? { guardTripped } : {}),
  };
  try {
    const c = await entry.credentials();
    // Broker name and currency come from the database: asking the broker for them on every poll is expensive.
    const [stats, positions, deals] = await Promise.all([
      broker.stats(c, entry.number),
      broker.positions(c, entry.number),
      broker.deals(c, entry.number, from.toISOString(), now.toISOString()),
    ]);
    const dealsToday = deals.filter((d) => Date.parse(d.time) >= utcDayStart.getTime());
    const challenge = profile
      ? await evaluateForAccount(db, entry.id, profile, { balance: stats.balance, equity: stats.equity, deals }, now)
      : undefined;
    return {
      ...base,
      broker: entry.broker,
      currency: entry.currency,
      data: { stats, positions, dealsToday },
      ...(challenge ? { challenge } : {}),
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
