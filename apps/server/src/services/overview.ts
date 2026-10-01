import {
  buildAccountDetail,
  buildOverview,
  profileDay,
  readLabels,
  tradingDayStart,
  type AccountDetail,
  type AccountSnapshot,
  type AccountStats,
  type AdapterErrorCode,
  type ChallengeProfile,
  type Deal,
  type Overview,
  type OverviewInput,
  type PendingOrder,
  type Position,
  type RuntimeInstance,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory, AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import { evaluateForAccount, readProfiles } from "../challenges/store";
import type { Db } from "../db";
import { brokerErrorCode } from "./broker-error";
import { clockOffset } from "./clock-check";
import type { LogTracker } from "./log-tracker";
import { guardTripToday } from "./loss-guard";
import { loadOverrides } from "./overrides";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long after its start a running load is still joined. A hanging broker session must not hand out old data under a
 * caller's fresh time: later callers start a load of their own.
 */
const JOIN_WITHIN_MS = 5_000;

export interface OverviewLoaderOptions {
  adapters: Adapters;
  directory: AccountDirectory;
  db: Db;
  labelPrefix: string;
  logTracker: LogTracker;
  /** For failed broker queries. */
  log: FastifyBaseLogger;
}

/** What runtime and broker answered in one load, as of `time`. */
interface Fetched {
  time: Date;
  instances: RuntimeInstance[];
  logs: Awaited<ReturnType<LogTracker["read"]>>;
  accounts: FetchedAccount[];
}

interface RunningLoad {
  time: Date;
  fetched: Promise<Fetched>;
}

interface FetchedAccount {
  entry: AccountEntry;
  profile: ChallengeProfile | undefined;
  /** Deals since dealsFrom(time); the error of a failed query is already logged. */
  answer:
    { stats: AccountStats; positions: Position[]; deals: Deal[]; pendingOrders?: PendingOrder[] } | AdapterErrorCode;
}

/**
 * Builds the overview and the account pages. Every browser tab, the notifier and the daily summary ask on their own;
 * callers that ask while a load of the same accounts (or of all accounts) started just before is running share its
 * runtime, log and broker queries. What depends on the time (today's deals, challenge, loss guard, clock) is derived
 * per caller with its own `now`.
 */
export class OverviewLoader {
  /** Running loads by the one account asked for; `undefined` for all accounts. */
  private readonly running = new Map<string | undefined, RunningLoad>();

  constructor(private readonly options: OverviewLoaderOptions) {}

  /** Runtime and broker are queried in parallel; failures per account become alerts. */
  async overview(now = new Date()): Promise<Overview> {
    return buildOverview(await this.input(now));
  }

  /**
   * One account for its page, from the same data as the overview; only this account is asked at the broker. Undefined
   * if wickwatch does not know the account.
   */
  async accountDetail(number: string, now = new Date()): Promise<AccountDetail | undefined> {
    return buildAccountDetail(await this.input(now, number), number);
  }

  private async input(now: Date, only?: string): Promise<OverviewInput> {
    const { adapters, db, labelPrefix } = this.options;
    const [fetched, overrides, stopped] = await Promise.all([
      this.fetch(now, only),
      loadOverrides(db, adapters.broker.id),
      // Managed instances are named after their runtime ref.
      db.selectFrom("instances").select("name").where("stopped_by_user", "=", 1).execute(),
    ]);
    const accounts = await Promise.all(fetched.accounts.map((account) => snapshot(db, account, now)));
    const clockOffsetMs = clockOffset(now.getTime());
    return {
      time: now,
      labelPrefix,
      instances: fetched.instances,
      lastLogs: fetched.logs.lastLines,
      logStates: fetched.logs.states,
      accounts,
      overrides,
      stoppedByUser: new Set(stopped.map((row) => row.name)),
      ...(clockOffsetMs !== undefined ? { clockOffsetMs } : {}),
    };
  }

  /**
   * Joins a running load if it was started at `now` or up to JOIN_WITHIN_MS before: the day starts of a later `now` are
   * no earlier, so the deals asked for cover its days as well (everything using them filters by its own day). One
   * account also joins a load of all accounts. A caller with an earlier `now` gets a load of its own; so does one more
   * than JOIN_WITHIN_MS later, whose load then replaces the running one for the callers after it.
   */
  private fetch(now: Date, only: string | undefined): Promise<Fetched> {
    const joinable = (load: RunningLoad) => load.time <= now && now.getTime() - load.time.getTime() <= JOIN_WITHIN_MS;
    const running = this.running.get(only);
    if (running && joinable(running)) return running.fetched;
    if (only !== undefined) {
      const all = this.running.get(undefined);
      if (all && joinable(all)) return all.fetched.then((fetched) => this.narrow(fetched, only));
    }
    const fetched = this.query(now, only);
    // Kept for the callers after it, unless the running load started later (this caller asked for an earlier time).
    if (!running || running.time < now) {
      this.running.set(only, { time: now, fetched });
      const done = () => {
        if (this.running.get(only)?.fetched === fetched) this.running.delete(only);
      };
      void fetched.then(done, done);
    }
    return fetched;
  }

  private async query(now: Date, only: string | undefined): Promise<Fetched> {
    const { adapters, directory, db, logTracker } = this.options;
    const [instances, allEntries, profiles] = await Promise.all([
      adapters.runtime.list(),
      directory.list(),
      readProfiles(db),
    ]);
    const entries = only === undefined ? allEntries : allEntries.filter((e) => e.number === only);
    const [logs, accounts] = await Promise.all([
      logTracker.read(this.shown(instances, only)),
      Promise.all(
        entries.map(async (entry): Promise<FetchedAccount> => {
          const profile = profiles.get(entry.id);
          return { entry, profile, answer: await this.ask(entry, profile, now) };
        }),
      ),
    ]);
    return { time: now, instances, logs, accounts };
  }

  /** Logs are read only of the instances shown; attribution still needs all of them. */
  private shown(instances: RuntimeInstance[], only: string | undefined): RuntimeInstance[] {
    const { labelPrefix } = this.options;
    return only === undefined ? instances : instances.filter((i) => readLabels(labelPrefix, i.labels).account === only);
  }

  /** A load of all accounts cut down to what a load of `only` fetches. */
  private narrow(fetched: Fetched, only: string): Fetched {
    const refs = new Set(this.shown(fetched.instances, only).map((i) => i.ref));
    const keep = <T>(map: Map<string, T>) => new Map([...map].filter(([ref]) => refs.has(ref)));
    return {
      ...fetched,
      logs: { states: keep(fetched.logs.states), lastLines: keep(fetched.logs.lastLines) },
      accounts: fetched.accounts.filter((a) => a.entry.number === only),
    };
  }

  private async ask(
    entry: AccountEntry,
    profile: ChallengeProfile | undefined,
    now: Date,
  ): Promise<FetchedAccount["answer"]> {
    const { broker } = this.options.adapters;
    try {
      const c = await entry.credentials();
      // Broker name and currency come from the database: asking the broker for them on every poll is expensive.
      const [stats, positions, deals, pendingOrders] = await Promise.all([
        broker.stats(c, entry.number),
        broker.positions(c, entry.number),
        broker.deals(c, entry.number, dealsFrom(now, profile).toISOString(), now.toISOString()),
        broker.capabilities().pendingOrders ? broker.pendingOrders(c, entry.number) : undefined,
      ]);
      return { stats, positions, deals, ...(pendingOrders ? { pendingOrders } : {}) };
    } catch (error) {
      return brokerErrorCode(error, entry.number, this.options.log);
    }
  }
}

const utcDayStart = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);

/** "Today" is the UTC day; accounts with a challenge profile also need their own trading day. */
function dealsFrom(now: Date, profile: ChallengeProfile | undefined): Date {
  if (!profile) return utcDayStart(now);
  const { resetTime, timeZone } = profileDay(profile.rules);
  return new Date(Math.min(utcDayStart(now).getTime(), tradingDayStart(now, resetTime, timeZone).getTime()));
}

async function snapshot(db: Db, { entry, profile, answer }: FetchedAccount, now: Date): Promise<AccountSnapshot> {
  // Shown even when the broker cannot be asked right now.
  const guardTripped = profile ? await guardTripToday(db, entry.id, profile.rules, now) : undefined;
  const base = {
    number: entry.number,
    displayName: entry.displayName,
    ...(entry.credentialLabel ? { credentialLabel: entry.credentialLabel } : {}),
    ...(guardTripped ? { guardTripped } : {}),
  };
  if (typeof answer === "string") return { ...base, error: answer };
  const { stats, positions, deals, pendingOrders } = answer;
  const dayStart = utcDayStart(now).getTime();
  const dealsToday = deals.filter((d) => Date.parse(d.time) >= dayStart);
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
}
