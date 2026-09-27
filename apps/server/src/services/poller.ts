import { profileDay, tradingDayKey, tradingDayStart } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import { readProfiles } from "../challenges/store";
import type { Db } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Without a challenge profile, trading days are recorded for this long. */
const DEFAULT_HISTORY_DAYS = 30;

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
 * The dashboard only watches; hard limits belong into the bot (docs/BOT-CONTRACT.md).
 */
export class AccountPoller {
  private timers: ReturnType<typeof setInterval>[] = [];
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

  /** Marks the trading days with closed trades since the profile start (or the last 30 days). */
  async pollDeals(): Promise<void> {
    const { db, adapters, log } = this.options;
    const [targets, profiles] = await Promise.all([this.targets(), readProfiles(db)]);
    await Promise.all(
      targets.map(async ({ id, entry }) => {
        try {
          const profile = profiles.get(id);
          const { resetTime, timeZone } = profileDay(profile?.rules ?? {});
          const now = this.now();
          const from = profile
            ? tradingDayStart(new Date(`${profile.startDate}T12:00:00Z`), resetTime, timeZone)
            : new Date(now.getTime() - DEFAULT_HISTORY_DAYS * DAY_MS);
          const deals = await adapters.broker.deals(
            await entry.credentials(),
            entry.number,
            from.toISOString(),
            now.toISOString(),
          );
          const days = [
            ...new Set(
              deals.filter((d) => d.pnl !== 0).map((d) => tradingDayKey(new Date(d.time), resetTime, timeZone)),
            ),
          ];
          if (!days.length) return;
          await db
            .insertInto("daily_stats")
            .values(days.map((day) => ({ account_id: id, day, traded: 1 })))
            .onConflict((oc) => oc.columns(["account_id", "day"]).doUpdateSet({ traded: 1 }))
            .execute();
        } catch (error) {
          log.warn({ err: error, account: entry.number }, "Polling account deals failed");
        }
      }),
    );
  }

  private async targets() {
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
