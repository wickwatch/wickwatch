import {
  errorCode,
  isAdapterError,
  profileDay,
  tradingDayKey,
  tradingDayStart,
  type RuleResult,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountDirectory, AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";
import { evaluateForAccount, readProfiles } from "../challenges/store";
import type { Db } from "../db";
import { audit } from "./audit";
import { stopAccount } from "./instance-keeper";

export interface LossGuardOptions {
  db: Db;
  adapters: Adapters;
  accounts: AccountDirectory;
  labelPrefix: string;
  log: FastifyBaseLogger;
  intervalMs?: number;
  now?: () => Date;
}

const GUARDED: RuleResult["id"][] = ["dailyLoss", "maxLoss"];

/**
 * Runs the emergency stop for an account whose challenge profile has a loss guard, once the daily or
 * max loss limit is used up to the guard's share. Acts once per trading day: instances started again by
 * hand that day are left alone. It evaluates like the traffic light (day-start values that survive bot
 * restarts), every ACCOUNT_POLL_SECONDS – a second line of defence behind the bot's own stop.
 */
export class LossGuardService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly now: () => Date;

  constructor(private readonly options: LossGuardOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { db, accounts } = this.options;
      const [profiles, entries] = await Promise.all([readProfiles(db), accounts.list()]);
      // In parallel: a hanging broker session of one account must not delay the stop of another.
      await Promise.all(
        entries.map(async (entry) => {
          const profile = profiles.get(entry.id);
          if (!profile?.guard) return;
          await this.guard(entry, profile, profile.guard.usagePct).catch((error: unknown) => {
            this.options.log.error({ err: error, account: entry.number }, "Loss guard check failed");
          });
        }),
      );
    } catch (error) {
      this.options.log.error({ err: error }, "Loss guard check failed");
    } finally {
      this.running = false;
    }
  }

  private async guard(
    entry: AccountEntry,
    profile: Parameters<typeof evaluateForAccount>[2],
    usagePct: number,
  ): Promise<void> {
    const { db, adapters, labelPrefix, log } = this.options;
    const now = this.now();
    const { resetTime, timeZone } = profileDay(profile.rules);
    const day = tradingDayKey(now, resetTime, timeZone);
    const done = await db
      .selectFrom("guard_trips")
      .select("ok")
      .where("account_id", "=", entry.id)
      .where("day", "=", day)
      .executeTakeFirst();
    if (done?.ok === 1) return;

    let evaluation;
    try {
      const credentials = await entry.credentials();
      const [stats, deals] = await Promise.all([
        adapters.broker.stats(credentials, entry.number),
        adapters.broker.deals(
          credentials,
          entry.number,
          tradingDayStart(now, resetTime, timeZone).toISOString(),
          now.toISOString(),
        ),
      ]);
      evaluation = await evaluateForAccount(
        db,
        entry.id,
        profile,
        { balance: stats.balance, equity: stats.equity, deals },
        now,
      );
    } catch (error) {
      // Without data there is nothing to judge; the next check tries again.
      if (!isAdapterError(error)) log.error({ err: error, account: entry.number }, "Loss guard query failed");
      return;
    }
    const hit = evaluation.rules.find((r) => GUARDED.includes(r.id) && r.usage * 100 >= usagePct);
    if (!hit) return;

    log.warn({ account: entry.number, rule: hit.id, usage: hit.usage }, "Loss guard: stopping the account");
    let ok = false;
    let details: Record<string, unknown>;
    try {
      const report = await stopAccount(db, entry, { runtime: adapters.runtime, broker: adapters.broker, labelPrefix });
      ok = true;
      details = { ...report };
    } catch (error) {
      details = { error: errorCode(error) };
      log.error({ err: error, account: entry.number }, "Loss guard: the emergency stop failed, retrying next check");
    }
    const at = now.toISOString();
    await db
      .insertInto("guard_trips")
      .values({ account_id: entry.id, day, rule: hit.id, usage: hit.usage, ok: ok ? 1 : 0, at })
      .onConflict((oc) =>
        oc.columns(["account_id", "day"]).doUpdateSet({ rule: hit.id, usage: hit.usage, ok: ok ? 1 : 0, at }),
      )
      .execute();
    await audit(db, {
      action: "account.loss_guard",
      target: entry.number,
      details: { ok, rule: hit.id, usage: Math.round(hit.usage * 1000) / 10, threshold: usagePct, ...details },
    });
  }
}

/** The guard's successful action in the account's current trading day, for the overview alert. */
export async function guardTripToday(
  db: Db,
  accountId: number,
  rules: Parameters<typeof profileDay>[0],
  now: Date,
): Promise<{ at: string; rule: string } | undefined> {
  const { resetTime, timeZone } = profileDay(rules);
  const row = await db
    .selectFrom("guard_trips")
    .select(["at", "rule"])
    .where("account_id", "=", accountId)
    .where("day", "=", tradingDayKey(now, resetTime, timeZone))
    .where("ok", "=", 1)
    .executeTakeFirst();
  return row;
}
