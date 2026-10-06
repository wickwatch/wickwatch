import {
  ChallengeProfile,
  DAY_START_TOLERANCE_MS,
  dealResult,
  evaluateChallenge,
  profileDay,
  tradingDayKey,
  tradingDayStart,
  tradingDayStartOf,
  tradingDays,
  type ChallengeEvaluation,
  type Deal,
  type Position,
} from "@wickwatch/core";
import Value from "typebox/value";
import type { Db } from "../db";

export async function readProfile(db: Db, accountId: number): Promise<ChallengeProfile | undefined> {
  const row = await db
    .selectFrom("challenge_profiles")
    .select("profile")
    .where("account_id", "=", accountId)
    .executeTakeFirst();
  if (!row) return undefined;
  const data: unknown = JSON.parse(row.profile);
  return Value.Check(ChallengeProfile, data) ? data : undefined;
}

export async function readProfiles(db: Db): Promise<Map<number, ChallengeProfile>> {
  const rows = await db.selectFrom("challenge_profiles").select(["account_id", "profile"]).execute();
  const profiles = new Map<number, ChallengeProfile>();
  for (const row of rows) {
    const data: unknown = JSON.parse(row.profile);
    if (Value.Check(ChallengeProfile, data)) profiles.set(row.account_id, data);
  }
  return profiles;
}

/** Combines the live account state with the recorded trading days into the evaluation. */
export async function evaluateForAccount(
  db: Db,
  accountId: number,
  profile: ChallengeProfile,
  /** Deals since the current trading day started; open positions when at hand, so one opened today counts at once. */
  state: { balance: number; equity: number; deals: Deal[]; positions?: Position[] },
  now: Date,
): Promise<ChallengeEvaluation> {
  const { resetTime, timeZone } = profileDay(profile.rules);
  const today = tradingDayKey(now, resetTime, timeZone);
  const rows = await db
    .selectFrom("daily_stats")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("day", ">=", profile.startDate)
    .orderBy("day")
    .execute();
  const synced = await db
    .selectFrom("challenge_profiles")
    .select("trading_days_from")
    .where("account_id", "=", accountId)
    .executeTakeFirst();
  const todayRow = rows.find((r) => r.day === today);
  const peaks = rows.map((r) => r.max_equity).filter((v): v is number => v !== null);
  // Today's day-start balance comes exactly from today's deals; earlier days from their first sample.
  const earlierStarts = rows.filter((r) => r.day < today && r.start_balance !== null && r.first_sample_at !== null);
  const peakDayStartBalance = earlierStarts.length
    ? {
        value: Math.max(...earlierStarts.map((r) => r.start_balance as number)),
        approximate: earlierStarts.some(
          (r) =>
            Date.parse(r.first_sample_at as string) - tradingDayStartOf(r.day, resetTime, timeZone).getTime() >
            DAY_START_TOLERANCE_MS,
        ),
      }
    : undefined;
  const dayStart = tradingDayStart(now, resetTime, timeZone).getTime();
  const dealsToday = state.deals.filter((d) => Date.parse(d.time) >= dayStart);
  const realizedToday = dealsToday.reduce((sum, d) => sum + dealResult(d), 0);
  // Today counts as soon as a position opened today, even before the poller marked the day.
  const tradedToday =
    todayRow?.traded !== 1 && tradingDays(dealsToday, state.positions ?? [], resetTime, timeZone).includes(today);

  const traded = rows.filter((r) => r.traded === 1);
  const lastTradingDay = tradedToday ? today : traded.at(-1)?.day;

  return evaluateChallenge({
    now,
    profile,
    balance: state.balance,
    equity: state.equity,
    realizedToday,
    ...(todayRow
      ? {
          today: {
            ...(todayRow.start_equity !== null ? { startEquity: todayRow.start_equity } : {}),
            ...(todayRow.min_equity !== null ? { minEquity: todayRow.min_equity } : {}),
            ...(todayRow.first_sample_at !== null ? { firstSampleAt: todayRow.first_sample_at } : {}),
          },
        }
      : {}),
    ...(peaks.length ? { peakEquity: Math.max(...peaks, state.equity) } : { peakEquity: state.equity }),
    ...(peakDayStartBalance ? { peakDayStartBalance } : {}),
    tradingDays: traded.length + (tradedToday ? 1 : 0),
    ...(lastTradingDay ? { lastTradingDay } : {}),
    ...(!synced?.trading_days_from || synced.trading_days_from > profile.startDate ? { tradingDaysPending: true } : {}),
  });
}
