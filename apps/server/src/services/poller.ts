import {
  profileDay,
  tradingDayKey,
  tradingDays,
  tradingDayStart,
  tradingDayStartOf,
  type ChallengeProfile,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { findAccountById, type AccountDirectory, type AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import { readProfile, readProfiles } from "../challenges/store";
import type { Db } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Without a challenge profile, trading days are recorded for this long. */
const DEFAULT_HISTORY_DAYS = 30;
/**
 * After the first full run per account (since the profile start), the regular runs ask only the deals of the last
 * trading days: earlier days are recorded, and a position still open marks its day through the positions. A whole
 * challenge's history every 5 minutes made the broker's answer large enough to run into the CLI's timeout whenever the
 * broker was slow.
 */
const RECENT_DAYS = 3;
/** A full run asks in pieces this long, so no single answer gets large enough to run into the timeout. */
const PIECE_DAYS = 30;

export interface PollerOptions {
  db: Db;
  adapters: Adapters;
  accounts: AccountDirectory;
  log: FastifyBaseLogger;
  statsIntervalMs?: number;
  dealsIntervalMs?: number;
  now?: () => Date;
}

/** A timer callback that skips its tick while the last run still goes, so a slow broker does not pile up runs. */
function skipWhileRunning(run: () => Promise<void>): () => void {
  let busy = false;
  return () => {
    if (busy) return;
    busy = true;
    void run().finally(() => {
      busy = false;
    });
  };
}

/**
 * Samples balance and equity of every account (default every 60 s) and marks trading days from
 * the deals (every 5 min). Keeps per trading day: start, minimum and maximum equity.
 * Hard limits belong into the bot (docs/BOT-CONTRACT.md); the optional loss guard (loss-guard.ts) acts on these samples.
 */
export class AccountPoller {
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly running = new Map<number, Promise<void>>();
  /**
   * Per account id, the start of the last full run (profile start date, or "default" for the last 30 days) and when
   * the last run was done. In memory on purpose, unlike challenge_profiles.trading_days_from: a server start runs in
   * full again, which catches up on the days it was down.
   */
  private readonly synced = new Map<number, { scope: string; at: Date }>();
  private readonly now: () => Date;

  constructor(private readonly options: PollerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    const { statsIntervalMs = 60_000, dealsIntervalMs = 5 * 60_000 } = this.options;
    void this.pollStats().then(() => this.pollDeals());
    this.timers.push(
      setInterval(
        skipWhileRunning(() => this.pollStats()),
        statsIntervalMs,
      ),
    );
    this.timers.push(
      setInterval(
        skipWhileRunning(() => this.pollDeals()),
        dealsIntervalMs,
      ),
    );
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** Records one balance/equity sample per account. Errors are logged; the next run retries. */
  async pollStats(): Promise<void> {
    const { db, adapters, log } = this.options;
    const [entries, profiles] = await Promise.all([this.options.accounts.list(), readProfiles(db)]);
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const stats = await adapters.broker.stats(await entry.credentials(), entry.number);
          const { resetTime, timeZone } = profileDay(profiles.get(entry.id)?.rules ?? {});
          const now = this.now();
          const day = tradingDayKey(now, resetTime, timeZone);
          const at = now.toISOString();
          await db
            .insertInto("daily_stats")
            .values({
              account_id: entry.id,
              day,
              start_balance: stats.balance,
              start_equity: stats.equity,
              min_equity: stats.equity,
              max_equity: stats.equity,
              first_sample_at: at,
              last_sample_at: at,
            })
            .onConflict((oc) =>
              oc.columns(["account_id", "day"]).doUpdateSet((eb) => ({
                // Rows created by pollDeals have no samples yet; the first sample fills them.
                start_balance: eb.fn.coalesce("daily_stats.start_balance", eb.val(stats.balance)),
                start_equity: eb.fn.coalesce("daily_stats.start_equity", eb.val(stats.equity)),
                first_sample_at: eb.fn.coalesce("daily_stats.first_sample_at", eb.val(at)),
                min_equity: eb.fn("min", [
                  eb.fn.coalesce("daily_stats.min_equity", eb.val(stats.equity)),
                  eb.val(stats.equity),
                ]),
                max_equity: eb.fn("max", [
                  eb.fn.coalesce("daily_stats.max_equity", eb.val(stats.equity)),
                  eb.val(stats.equity),
                ]),
                last_sample_at: at,
              })),
            )
            .execute();
        } catch (error) {
          log.warn({ err: error, account: entry.number }, "Polling account stats failed");
        }
      }),
    );
  }

  /**
   * Marks the trading days (a position opened, see tradingDays) since the profile start (or the last 30 days); after
   * the first full run per account only the last RECENT_DAYS trading days.
   */
  async pollDeals(): Promise<void> {
    const [entries, profiles] = await Promise.all([this.options.accounts.list(), readProfiles(this.options.db)]);
    await Promise.all(entries.map((entry) => this.syncDeals(entry, profiles.get(entry.id))));
  }

  /** Marks the trading days of one account right away and in full, e.g. after its challenge profile was saved. */
  async syncTradingDays(accountId: number): Promise<void> {
    const entry = await findAccountById(this.options.accounts, accountId);
    if (entry) await this.syncDeals(entry, await readProfile(this.options.db, accountId), true);
  }

  /** One run per account at a time: a save during the regular run waits for it and then runs again. */
  private syncDeals(entry: AccountEntry, profile: ChallengeProfile | undefined, full = false): Promise<void> {
    const previous = this.running.get(entry.id) ?? Promise.resolve();
    const run = previous.then(() => this.markTradingDays(entry, profile, full));
    this.running.set(entry.id, run);
    void run.finally(() => {
      if (this.running.get(entry.id) === run) this.running.delete(entry.id);
    });
    return run;
  }

  private async markTradingDays(
    entry: AccountEntry,
    profile: ChallengeProfile | undefined,
    full: boolean,
  ): Promise<void> {
    const { db, adapters, log } = this.options;
    try {
      const { resetTime, timeZone } = profileDay(profile?.rules ?? {});
      const now = this.now();
      const scope = profile?.startDate ?? "default";
      const start = profile
        ? tradingDayStartOf(profile.startDate, resetTime, timeZone)
        : new Date(now.getTime() - DEFAULT_HISTORY_DAYS * DAY_MS);
      const synced = this.synced.get(entry.id);
      // Since the last run that was done, at least the last RECENT_DAYS trading days.
      const recentStart =
        !full && synced?.scope === scope
          ? Math.min(
              tradingDayStart(new Date(now.getTime() - (RECENT_DAYS - 1) * DAY_MS), resetTime, timeZone).getTime(),
              tradingDayStart(synced.at, resetTime, timeZone).getTime(),
            )
          : 0;
      const from = new Date(Math.max(start.getTime(), recentStart));
      const credentials = await entry.credentials();
      const deals = [];
      for (let piece = from.getTime(); piece < now.getTime(); piece += PIECE_DAYS * DAY_MS) {
        const to = Math.min(piece + PIECE_DAYS * DAY_MS, now.getTime());
        deals.push(
          ...(await adapters.broker.deals(
            credentials,
            entry.number,
            new Date(piece).toISOString(),
            new Date(to).toISOString(),
          )),
        );
      }
      const positions = await adapters.broker.positions(credentials, entry.number);
      const firstDay = tradingDayKey(from, resetTime, timeZone);
      const days = [...new Set(tradingDays(deals, positions, resetTime, timeZone))].filter((day) => day >= firstDay);
      // Days marked before (e.g. by closing day, as older versions did) that no position was opened on.
      await db
        .updateTable("daily_stats")
        .set({ traded: 0 })
        .where("account_id", "=", entry.id)
        .where("day", ">=", firstDay)
        .where("traded", "=", 1)
        .$if(days.length > 0, (q) => q.where("day", "not in", days))
        .execute();
      if (days.length) {
        await db
          .insertInto("daily_stats")
          .values(days.map((day) => ({ account_id: entry.id, day, traded: 1 })))
          .onConflict((oc) => oc.columns(["account_id", "day"]).doUpdateSet({ traded: 1 }))
          .execute();
      }
      if (profile && !recentStart) {
        await db
          .updateTable("challenge_profiles")
          .set({ trading_days_from: profile.startDate })
          .where("account_id", "=", entry.id)
          .execute();
      }
      this.synced.set(entry.id, { scope, at: now });
    } catch (error) {
      log.warn({ err: error, account: entry.number }, "Polling account deals failed");
    }
  }
}
