import {
  ChallengeProfile,
  dealResult,
  evaluateChallenge,
  profileDay,
  tradingDayKey,
  tradingDayStart,
  type ChallengeEvaluation,
  type Deal,
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
  state: { balance: number; equity: number; deals: Deal[] },
  now: Date,
): Promise<ChallengeEvaluation> {
  const { resetTime, timeZone } = profileDay(profile.rules);
  const today = tradingDayKey(now, resetTime, timeZone);
  const rows = await db
    .selectFrom("daily_stats")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("day", ">=", profile.startDate)
    .execute();
  const todayRow = rows.find((r) => r.day === today);
  const peaks = rows.map((r) => r.max_equity).filter((v): v is number => v !== null);
  const dayStart = tradingDayStart(now, resetTime, timeZone).getTime();
  const dealsToday = state.deals.filter((d) => Date.parse(d.time) >= dayStart);
  const realizedToday = dealsToday.reduce((sum, d) => sum + dealResult(d), 0);
  // Today counts as soon as a trade closed, even before the poller marked the day.
  const tradedToday = dealsToday.some((d) => d.pnl !== 0) && todayRow?.traded !== 1;

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
    tradingDays: rows.filter((r) => r.traded === 1).length + (tradedToday ? 1 : 0),
  });
}
