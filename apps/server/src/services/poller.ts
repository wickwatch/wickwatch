import { profileDay, tradingDayKey, tradingDays, tradingDayStartOf, type ChallengeProfile } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory, AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import { readProfile, readProfiles } from "../challenges/store";
import type { Db } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Without a challenge profile, trading days are recorded for this long. */
const DEFAULT_HISTORY_DAYS = 30;

interface Target {
  id: number;
  entry: AccountEntry;
}

export interface PollerOptions {
  db: Db;
  adapters: Adapters;
  accounts: AccountDirectory;
  log: FastifyBaseLogger;
  statsIntervalMs?: number;
  dealsIntervalMs?: number;
  now?: () => Date;
}

/**
 * Samples balance and equity of every account (default every 60 s) and marks trading days from
 * the deals (every 5 min). Keeps per trading day: start, minimum and maximum equity.
 * Hard limits belong into the bot (docs/BOT-CONTRACT.md); the optional loss guard (loss-guard.ts) acts on these samples.
 */
export class AccountPoller {
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly running = new Map<number, Promise<void>>();
  private readonly now: () => Date;

  constructor(private readonly options: PollerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    const { statsIntervalMs = 60_000, dealsIntervalMs = 5 * 60_000 } = this.options;
    void this.pollStats().then(() => this.pollDeals());
    this.timers.push(setInterval(() => void this.pollStats(), statsIntervalMs));
    this.timers.push(setInterval(() => void this.pollDeals(), dealsIntervalMs));
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** Records one balance/equity sample per account. Errors are logged; the next run retries. */
  async pollStats(): Promise<void> {
    const { db, adapters, log } = this.options;
    const [targets, profiles] = await Promise.all([this.targets(), readProfiles(db)]);
    await Promise.all(
      targets.map(async ({ id, entry }) => {
        try {
          const stats = await adapters.broker.stats(await entry.credentials(), entry.number);
          const { resetTime, timeZone } = profileDay(profiles.get(id)?.rules ?? {});
          const now = this.now();
          const day = tradingDayKey(now, resetTime, timeZone);
          const at = now.toISOString();
          await db
            .insertInto("daily_stats")
            .values({
              account_id: id,
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

  /** Marks the trading days (a position opened, see tradingDays) since the profile start (or the last 30 days). */
  async pollDeals(): Promise<void> {
    const [targets, profiles] = await Promise.all([this.targets(), readProfiles(this.options.db)]);
    await Promise.all(targets.map((target) => this.syncDeals(target, profiles.get(target.id))));
  }

  /** Marks the trading days of one account right away, e.g. after its challenge profile was saved. */
  async syncTradingDays(accountId: number): Promise<void> {
    const target = (await this.targets()).find((t) => t.id === accountId);
    if (target) await this.syncDeals(target, await readProfile(this.options.db, accountId));
  }

  /** One run per account at a time: a save during the regular run waits for it and then runs again. */
  private syncDeals(target: Target, profile: ChallengeProfile | undefined): Promise<void> {
    const previous = this.running.get(target.id) ?? Promise.resolve();
    const run = previous.then(() => this.markTradingDays(target, profile));
    this.running.set(target.id, run);
    void run.finally(() => {
      if (this.running.get(target.id) === run) this.running.delete(target.id);
    });
    return run;
  }

  private async markTradingDays({ id, entry }: Target, profile: ChallengeProfile | undefined): Promise<void> {
    const { db, adapters, log } = this.options;
    try {
      const { resetTime, timeZone } = profileDay(profile?.rules ?? {});
      const now = this.now();
      const from = profile
        ? tradingDayStartOf(profile.startDate, resetTime, timeZone)
        : new Date(now.getTime() - DEFAULT_HISTORY_DAYS * DAY_MS);
      const credentials = await entry.credentials();
      const [deals, positions] = await Promise.all([
        adapters.broker.deals(credentials, entry.number, from.toISOString(), now.toISOString()),
        adapters.broker.positions(credentials, entry.number),
      ]);
      const firstDay = tradingDayKey(from, resetTime, timeZone);
      const days = [...new Set(tradingDays(deals, positions, resetTime, timeZone))].filter((day) => day >= firstDay);
      // Days marked before (e.g. by closing day, as older versions did) that no position was opened on.
      await db
        .updateTable("daily_stats")
        .set({ traded: 0 })
        .where("account_id", "=", id)
        .where("day", ">=", firstDay)
        .where("traded", "=", 1)
        .$if(days.length > 0, (q) => q.where("day", "not in", days))
        .execute();
      if (days.length) {
        await db
          .insertInto("daily_stats")
          .values(days.map((day) => ({ account_id: id, day, traded: 1 })))
          .onConflict((oc) => oc.columns(["account_id", "day"]).doUpdateSet({ traded: 1 }))
          .execute();
      }
      if (profile) {
        await db
          .updateTable("challenge_profiles")
          .set({ trading_days_from: profile.startDate })
          .where("account_id", "=", id)
          .execute();
      }
    } catch (error) {
      log.warn({ err: error, account: entry.number }, "Polling account deals failed");
    }
  }

  private async targets(): Promise<Target[]> {
    const { db, adapters, accounts } = this.options;
    const [rows, entries] = await Promise.all([
      db.selectFrom("accounts").select(["id", "number"]).where("adapter", "=", adapters.broker.id).execute(),
      accounts.list(),
    ]);
    return rows.flatMap((row) => {
      const entry = entries.find((e) => e.number === row.number);
      return entry ? [{ id: row.id, entry }] : [];
    });
  }
}
