import {
  buildAccountDetail,
  buildOverview,
  profileDay,
  readLabels,
  settle,
  tradingDayStart,
  type AccountDetail,
  type AccountSnapshot,
  type AccountStats,
  type AdapterErrorCode,
  type ChallengeProfile,
  type Deal,
  type InstanceSummary,
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
import { pauseOf } from "./schedules";
import { guardTripToday } from "./loss-guard";
import type { MarketHoursCache } from "./market-hours";
import { loadOverrides } from "./overrides";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long after its start a load is shared, running or done: several browser tabs polling on their own cycles, the
 * notifier and MCP clients then cost one broker query. Short, so the data stays fresh. Actions of wickwatch drop it
 * (withChangeNotice). An account's broker answer is reused for as long.
 */
const REUSE_WITHIN_MS = 15_000;
/**
 * How long a load waits for an account's broker answer before it shows the account's last answer instead; the query
 * goes on and its answer is shown from the next load on. A hanging or slow broker session then does not hold up the
 * overview: it answers in seconds even while a command waits for its timeout or a session logs in again.
 */
const ANSWER_WAIT_MS = 3000;
/** The last answer stands in for this long after it was asked; without a younger one the load waits for the broker. */
const LAST_ANSWER_MAX_AGE_MS = 5 * 60_000;

/** Runtime and broker actions that change what the overview shows. */
const RUNTIME_CHANGES = ["create", "update", "remove", "start", "stop", "restart"] as const;
const BROKER_CHANGES = ["closePosition", "cancelOrder", "emergencyStop"] as const;

/** What an action changed: the instances only (a bot started or stopped), or also the account at the broker. */
export type Change = "runtime" | "broker";

/** `target` with `changed` called after each of `methods`, also after a failed one: it may have changed something. */
function notifyAfter<T extends object>(target: T, methods: readonly string[], changed: () => void): T {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      if (typeof value !== "function") return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(object);
      if (typeof key !== "string" || !methods.includes(key)) return bound;
      return async (...args: unknown[]) => {
        try {
          return await bound(...args);
        } finally {
          changed();
        }
      };
    },
  });
}

/**
 * The adapters with `changed` called after every runtime and broker action that changes what the overview shows,
 * whoever runs it (a route, the instance keeper, the loss guard), so the next load asks again. Changes outside
 * wickwatch (a stop loss hit, a bot's own trade) show once the shared load is older than REUSE_WITHIN_MS.
 */
export function withChangeNotice(adapters: Adapters, changed: (change: Change) => void): Adapters {
  return {
    ...adapters,
    runtime: notifyAfter(adapters.runtime, RUNTIME_CHANGES, () => {
      changed("runtime");
    }),
    broker: notifyAfter(adapters.broker, BROKER_CHANGES, () => {
      changed("broker");
    }),
  };
}

export interface OverviewLoaderOptions {
  adapters: Adapters;
  directory: AccountDirectory;
  db: Db;
  labelPrefix: string;
  logTracker: LogTracker;
  /** For failed broker queries. */
  log: FastifyBaseLogger;
  /** Adds the trading hours of the instances' symbols, where known. */
  marketHours?: MarketHoursCache;
  /** ANSWER_WAIT_MS, for tests. */
  answerWaitMs?: number;
}

/** What runtime and broker answered in one load, as of `time`. */
interface Fetched {
  time: Date;
  instances: RuntimeInstance[];
  logs: Awaited<ReturnType<LogTracker["read"]>>;
  accounts: FetchedAccount[];
}

interface RecentLoad {
  time: Date;
  fetched: Promise<Fetched>;
}

type BrokerAnswer =
  { stats: AccountStats; positions: Position[]; deals: Deal[]; pendingOrders?: PendingOrder[] } | AdapterErrorCode;

/** A broker query of an account, asked at `time`: running (a promise) or done. */
interface Asked<A> {
  time: Date;
  answer: A;
}

/** Per account: the query running, one at a time as the broker runs an account's commands one by one, and the last. */
interface AccountAnswers {
  running?: Asked<Promise<BrokerAnswer>>;
  last?: Asked<BrokerAnswer>;
}

interface FetchedAccount {
  entry: AccountEntry;
  profile: ChallengeProfile | undefined;
  /** Deals since dealsFrom(the time asked); the error of a failed query is already logged. */
  answer: BrokerAnswer;
  /** Set when the last answer stands in, as the broker did not answer in time: when it was asked, and the query. */
  standIn?: { asOf: Date; pending: Promise<unknown> };
}

/**
 * Builds the overview and the account pages. Every browser tab, the notifier and the daily summary ask on their own;
 * callers that ask shortly after a load of the same accounts (or of all accounts) started share its runtime, log and
 * broker queries. What depends on the time (today's deals, challenge, loss guard, clock) is derived per caller with its
 * own `now`.
 */
export class OverviewLoader {
  /** Recent loads by the one account asked for; `undefined` for all accounts. */
  private readonly recent = new Map<string | undefined, RecentLoad>();
  /** Broker answers by account id. */
  private readonly answers = new Map<number, AccountAnswers>();

  constructor(private readonly options: OverviewLoaderOptions) {}

  /**
   * Forgets the recent loads after something changed, so the next caller asks again; loads still running finish for
   * the callers that joined them. After a broker action (a position closed) also the broker answers: the next caller
   * then waits for the broker's new one. Starting or stopping a bot changes nothing at the broker, so its answers stay,
   * and the next caller does not wait on a session that has to log in first.
   */
  invalidate(change: Change = "broker"): void {
    this.recent.clear();
    if (change === "broker") this.answers.clear();
  }

  /** Runtime and broker are queried in parallel; failures per account become alerts. */
  async overview(now = new Date()): Promise<Overview> {
    const { input, entries } = await this.input(now);
    const overview = buildOverview(input);
    return { ...overview, instances: this.withHours(overview.instances, entries) };
  }

  /**
   * One account for its page, from the same data as the overview; only this account is asked at the broker. Undefined
   * if wickwatch does not know the account.
   */
  async accountDetail(number: string, now = new Date()): Promise<AccountDetail | undefined> {
    const { input, entries } = await this.input(now, number);
    const detail = buildAccountDetail(input, number);
    return detail && { ...detail, instances: this.withHours(detail.instances, entries) };
  }

  private withHours(instances: InstanceSummary[], entries: AccountEntry[]): InstanceSummary[] {
    return this.options.marketHours?.attach(instances, entries) ?? instances;
  }

  /** The input of the overview, and the accounts it was loaded for. */
  private async input(now: Date, only?: string): Promise<{ input: OverviewInput; entries: AccountEntry[] }> {
    const { adapters, db, labelPrefix } = this.options;
    const [fetched, overrides, stopped] = await Promise.all([
      this.fetch(now, only),
      loadOverrides(db, adapters.broker.id),
      // Managed instances are named after their runtime ref.
      db
        .selectFrom("instances")
        .select(["name", "stopped_by_user", "paused_until", "pause_reasons"])
        .where((eb) => eb.or([eb("stopped_by_user", "=", 1), eb("paused_until", "is not", null)]))
        .execute(),
    ]);
    const accounts = await Promise.all(fetched.accounts.map((account) => snapshot(db, account, now)));
    const clockOffsetMs = clockOffset(now.getTime());
    const input: OverviewInput = {
      time: now,
      labelPrefix,
      instances: fetched.instances,
      lastLogs: fetched.logs.lastLines,
      logStates: fetched.logs.states,
      accounts,
      overrides,
      stoppedByUser: new Set(stopped.filter((row) => row.stopped_by_user === 1).map((row) => row.name)),
      paused: new Map(
        stopped.flatMap((row) => {
          const pause = pauseOf(row);
          return pause ? [[row.name, pause] as const] : [];
        }),
      ),
      ...(clockOffsetMs !== undefined ? { clockOffsetMs } : {}),
    };
    return { input, entries: fetched.accounts.map((a) => a.entry) };
  }

  /**
   * Shares a load, running or done, if it was started at `now` or up to REUSE_WITHIN_MS before: the day starts of a
   * later `now` are no earlier, so the deals asked for cover its days as well (everything using them filters by its own
   * day). One account also takes a load of all accounts. A caller with an earlier `now` gets a load of its own; so does
   * one more than REUSE_WITHIN_MS later, whose load then replaces the old one for the callers after it. A failed load
   * is not kept.
   */
  private fetch(now: Date, only: string | undefined): Promise<Fetched> {
    const reusable = (load: RecentLoad) => load.time <= now && now.getTime() - load.time.getTime() <= REUSE_WITHIN_MS;
    const recent = this.recent.get(only);
    if (recent && reusable(recent)) return recent.fetched;
    if (only !== undefined) {
      const all = this.recent.get(undefined);
      if (all && reusable(all)) return all.fetched.then((fetched) => this.narrow(fetched, only));
    }
    const fetched = this.query(now, only);
    // Kept for the callers after it, unless the recent load started later (this caller asked for an earlier time).
    if (!recent || recent.time < now) {
      this.recent.set(only, { time: now, fetched });
      const drop = () => {
        if (this.recent.get(only)?.fetched === fetched) this.recent.delete(only);
      };
      // Not kept past its use: a failed load at once, a done one once it is too old to share, one with stand-ins also
      // once the first of their queries is done, so the next caller gets its answer.
      void fetched.then((done) => {
        setTimeout(drop, REUSE_WITHIN_MS).unref();
        const pending = done.accounts.flatMap((account) => (account.standIn ? [account.standIn.pending] : []));
        if (pending.length) void Promise.race(pending).then(drop);
      }, drop);
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
          return { entry, profile, ...(await this.answer(entry, profile, now)) };
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

  /**
   * The account's broker answer for a load at `now`: the last one if asked at most REUSE_WITHIN_MS before; else that of
   * the query running for the account if it started no later (its deals then start no later either), or of a new one.
   * If that takes longer than ANSWER_WAIT_MS from the query's start, the last answer stands in while it is younger than
   * LAST_ANSWER_MAX_AGE_MS; the query goes on and its answer replaces the last one.
   */
  private async answer(
    entry: AccountEntry,
    profile: ChallengeProfile | undefined,
    now: Date,
  ): Promise<Pick<FetchedAccount, "answer" | "standIn">> {
    const state = this.answers.get(entry.id) ?? {};
    this.answers.set(entry.id, state);
    const { last } = state;
    const age = (asked: Asked<unknown>) => now.getTime() - asked.time.getTime();
    if (!state.running && last && last.time <= now && age(last) <= REUSE_WITHIN_MS) return { answer: last.answer };
    const asked =
      state.running && state.running.time <= now ? state.running : this.startQuery(entry, profile, now, state);
    if (!last || last.time > asked.time || age(last) > LAST_ANSWER_MAX_AGE_MS) return { answer: await asked.answer };
    const wait = (this.options.answerWaitMs ?? ANSWER_WAIT_MS) - age(asked);
    const answer = wait > 0 ? await settle(asked.answer, wait) : undefined;
    return answer !== undefined
      ? { answer }
      : { answer: last.answer, standIn: { asOf: last.time, pending: asked.answer } };
  }

  /**
   * Starts a query and keeps it as the running one unless one is running (a query of a later time: this caller asked
   * for an earlier one); its answer becomes the last one unless a younger one is there.
   */
  private startQuery(
    entry: AccountEntry,
    profile: ChallengeProfile | undefined,
    now: Date,
    state: AccountAnswers,
  ): Asked<Promise<BrokerAnswer>> {
    const asked = { time: now, answer: this.askBroker(entry, profile, now) };
    state.running ??= asked;
    void asked.answer.then((answer) => {
      // Dropped by invalidate() meanwhile: the answer may be from before the change, so it is not kept.
      if (this.answers.get(entry.id) !== state) return;
      if (state.running === asked) delete state.running;
      if (!state.last || state.last.time <= asked.time) state.last = { time: asked.time, answer };
    });
    return asked;
  }

  /** Never rejects: a failed query answers with its error code. */
  private async askBroker(
    entry: AccountEntry,
    profile: ChallengeProfile | undefined,
    now: Date,
  ): Promise<BrokerAnswer> {
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

async function snapshot(
  db: Db,
  { entry, profile, answer, standIn }: FetchedAccount,
  now: Date,
): Promise<AccountSnapshot> {
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
    ...(standIn ? { asOf: standIn.asOf.toISOString() } : {}),
    ...(challenge ? { challenge } : {}),
  };
}
