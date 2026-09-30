import {
  buildAccountDetail,
  buildOverview,
  isAdapterError,
  profileDay,
  readLabels,
  tradingDayStart,
  type AdapterErrorCode,
  type ChallengeProfile,
  type AccountDetail,
  type AccountSnapshot,
  type Overview,
  type OverviewInput,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory, AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import { evaluateForAccount, readProfiles } from "../challenges/store";
import type { Db } from "../db";
import { clockOffset } from "./clock-check";
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
  return buildOverview(await loadOverviewInput(adapters, directory, db, labelPrefix, logTracker, log, now));
}

/**
 * One account for its page, from the same data as the overview; only this account is asked at the broker. Undefined
 * if Wickwatch does not know the account.
 */
export async function loadAccountDetail(
  number: string,
  adapters: Adapters,
  directory: AccountDirectory,
  db: Db,
  labelPrefix: string,
  logTracker: LogTracker,
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<AccountDetail | undefined> {
  const input = await loadOverviewInput(adapters, directory, db, labelPrefix, logTracker, log, now, number);
  return buildAccountDetail(input, number);
}

async function loadOverviewInput(
  adapters: Adapters,
  directory: AccountDirectory,
  db: Db,
  labelPrefix: string,
  logTracker: LogTracker,
  log: FastifyBaseLogger,
  now: Date,
  only?: string,
): Promise<OverviewInput> {
  // "Today" is the UTC day; accounts with a challenge profile also need their own trading day.
  const utcDayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const [instances, allEntries, profiles, overrides] = await Promise.all([
    adapters.runtime.list(),
    directory.list(),
    readProfiles(db),
    loadOverrides(db, adapters.broker.id),
  ]);
  const entries = only === undefined ? allEntries : allEntries.filter((e) => e.number === only);
  // Logs only of the instances shown; attribution still needs all of them.
  const shown =
    only === undefined ? instances : instances.filter((i) => readLabels(labelPrefix, i.labels).account === only);
  const [logs, accounts] = await Promise.all([
    logTracker.read(shown),
    Promise.all(entries.map((entry) => snapshot(adapters, db, entry, profiles.get(entry.id), utcDayStart, now, log))),
  ]);
  const clockOffsetMs = clockOffset(now.getTime());
  return {
    time: now,
    labelPrefix,
    instances,
    lastLogs: logs.lastLines,
    logStates: logs.states,
    accounts,
    overrides,
    ...(clockOffsetMs !== undefined ? { clockOffsetMs } : {}),
  };
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
    const [stats, positions, deals, pendingOrders] = await Promise.all([
      broker.stats(c, entry.number),
      broker.positions(c, entry.number),
      broker.deals(c, entry.number, from.toISOString(), now.toISOString()),
      broker.capabilities().pendingOrders ? broker.pendingOrders(c, entry.number) : undefined,
    ]);
    const dealsToday = deals.filter((d) => Date.parse(d.time) >= utcDayStart.getTime());
    const challenge = profile
      ? await evaluateForAccount(
          db,
          entry.id,
          profile,
          { balance: stats.balance, equity: stats.equity, deals, positions },
          now,
        )
      : undefined;
    return {
      ...base,
      broker: entry.broker,
      currency: entry.currency,
      data: { stats, positions, dealsToday, ...(pendingOrders ? { pendingOrders } : {}) },
      ...(challenge ? { challenge } : {}),
    };
  } catch (error) {
    return { ...base, error: brokerErrorCode(error, entry.number, log) };
  }
}

/** What a failed broker query shows as; errors other than the adapter's own are logged. */
export function brokerErrorCode(error: unknown, account: string, log: FastifyBaseLogger): AdapterErrorCode {
  if (isAdapterError(error)) return error.code;
  log.error({ err: error, account }, "Broker query failed");
  return "unavailable";
}
