import type {
  ChallengeEvaluation,
  ChallengeProfile,
  Deal,
  LossLimits,
  Position,
  ChallengeRules,
  ChallengeStatus,
  RuleResult,
  RuleStatus,
} from "./schemas";
import { toIsoTime } from "./schemas";
import { daysBetween, tradingDayKey, tradingDayStart } from "./trading-day";

/** Day-start values count as recorded only if the first sample of the day came this soon after the reset. */
export const DAY_START_TOLERANCE_MS = 5 * 60 * 1000;

export interface DayRecord {
  startEquity?: number;
  minEquity?: number;
  /** When the first sample of the day was taken. */
  firstSampleAt?: string;
}

export interface ChallengeInput {
  now: Date;
  profile: ChallengeProfile;
  balance: number;
  equity: number;
  /** Realised result (incl. costs) of the deals closed since the current trading day started. */
  realizedToday: number;
  today?: DayRecord;
  /** Highest equity recorded since the start (for trailing max loss). */
  peakEquity?: number;
  /** Highest balance recorded at the start of an earlier trading day (for trailing-eod-balance max loss). */
  peakDayStartBalance?: { value: number; approximate: boolean };
  /** Trading days since the start (see tradingDays). */
  tradingDays: number;
  /** The trading days since the start are not all marked yet (new profile, earlier start date). */
  tradingDaysPending?: boolean;
  /** The latest trading day since the start (YYYY-MM-DD, see tradingDayKey); missing when there is none yet. */
  lastTradingDay?: string;
}

/**
 * Trading days as prop firms count them: the days a position was opened, from closed trades (their opening time,
 * or their closing time when the broker does not tell) and from positions still open.
 */
export function tradingDays(deals: Deal[], positions: Position[], resetTime: string, timeZone: string): string[] {
  return [
    ...deals.filter((d) => d.pnl !== 0).map((d) => d.openedAt ?? d.time),
    ...positions.map((p) => p.openedAt),
  ].map((time) => tradingDayKey(new Date(time), resetTime, timeZone));
}

/** Reset time and zone of the profile's trading day; UTC midnight without a daily-loss rule. */
export function profileDay(rules: ChallengeRules): { resetTime: string; timeZone: string } {
  return { resetTime: rules.dailyLoss?.resetTime ?? "00:00", timeZone: rules.dailyLoss?.timezone ?? "UTC" };
}

/**
 * The profile's loss limits in money, for a preview of the risk per trade: the daily limit as a share of the initial
 * balance, or of `dayStart` (the balance at the start of the trading day) when the rule takes the day start; the max
 * loss as a share of the initial balance, as evaluateChallenge measures them. Without a day start the initial balance
 * stands in; a rule that takes equity is estimated with the balance.
 */
export function lossLimitAmounts(profile: ChallengeProfile, dayStart?: number): LossLimits | undefined {
  const { dailyLoss, maxLoss } = profile.rules;
  if (!dailyLoss && !maxLoss) return undefined;
  const dailyBasis = dailyLoss?.limitBasis === "day-start" ? (dayStart ?? profile.startBalance) : profile.startBalance;
  return {
    ...(dailyLoss ? { daily: (dailyLoss.limitPct / 100) * dailyBasis } : {}),
    ...(maxLoss ? { max: (maxLoss.limitPct / 100) * profile.startBalance } : {}),
  };
}

function limitStatus(usage: number): RuleStatus {
  if (usage >= 1) return "breached";
  if (usage >= 0.8) return "danger";
  if (usage >= 0.5) return "warning";
  return "ok";
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Evaluates a challenge profile against the current account state. Pure: no I/O. */
export function evaluateChallenge(input: ChallengeInput): ChallengeEvaluation {
  const { profile, now, balance, equity } = input;
  const { rules, startBalance } = profile;
  const { resetTime, timeZone } = profileDay(rules);
  const dayStart = tradingDayStart(now, resetTime, timeZone);
  const today = tradingDayKey(now, resetTime, timeZone);
  const results: RuleResult[] = [];

  if (rules.profitTargetPct) {
    const value = round(pct(balance - startBalance, startBalance));
    const usage = value / rules.profitTargetPct;
    results.push({
      id: "profitTarget",
      status: usage >= 1 ? "reached" : "open",
      value,
      limit: rules.profitTargetPct,
      usage,
      unit: "percent",
    });
  }

  const dayLow = Math.min(equity, input.today?.minEquity ?? equity);
  const dayStartBalance = balance - input.realizedToday;

  if (rules.dailyLoss) {
    const recorded =
      input.today?.startEquity !== undefined &&
      input.today.firstSampleAt !== undefined &&
      Date.parse(input.today.firstSampleAt) - dayStart.getTime() <= DAY_START_TOLERANCE_MS;
    const dayStartEquity = recorded ? input.today?.startEquity : undefined;
    const reference =
      rules.dailyLoss.reference === "balance-at-day-start"
        ? dayStartBalance
        : rules.dailyLoss.reference === "equity-at-day-start"
          ? (dayStartEquity ?? dayStartBalance)
          : Math.max(dayStartBalance, dayStartEquity ?? dayStartBalance);
    const basis = rules.dailyLoss.limitBasis === "day-start" ? reference : startBalance;
    const loss = Math.max(0, reference - dayLow);
    const value = round(pct(loss, basis));
    const usage = value / rules.dailyLoss.limitPct;
    results.push({
      id: "dailyLoss",
      status: limitStatus(usage),
      value,
      limit: rules.dailyLoss.limitPct,
      usage,
      unit: "percent",
      ...(rules.dailyLoss.reference !== "balance-at-day-start" && !recorded ? { approximate: true } : {}),
    });
  }

  if (rules.maxLoss) {
    const { type } = rules.maxLoss;
    const peak =
      type === "trailing"
        ? (input.peakEquity ?? startBalance)
        : type === "trailing-eod-balance"
          ? Math.max(dayStartBalance, input.peakDayStartBalance?.value ?? startBalance)
          : startBalance;
    const base = Math.max(startBalance, peak);
    // Firms state the limit as a share of the initial balance, also when it trails.
    const value = round(pct(Math.max(0, base - dayLow), startBalance));
    const usage = value / rules.maxLoss.limitPct;
    results.push({
      id: "maxLoss",
      status: limitStatus(usage),
      value,
      limit: rules.maxLoss.limitPct,
      usage,
      unit: "percent",
      ...(type === "trailing-eod-balance" && input.peakDayStartBalance?.approximate ? { approximate: true } : {}),
    });
  }

  if (rules.minTradingDays) {
    const usage = input.tradingDays / rules.minTradingDays;
    results.push({
      id: "tradingDays",
      status: usage >= 1 ? "reached" : "open",
      value: input.tradingDays,
      limit: rules.minTradingDays,
      usage,
      unit: "days",
      ...(input.tradingDaysPending ? { pending: true } : {}),
    });
  }

  const day = Math.max(1, daysBetween(profile.startDate, today) + 1);
  if (rules.durationDays) {
    // Time running out is a warning; only passing the last day breaks the rule.
    const status: RuleStatus =
      day > rules.durationDays ? "breached" : day / rules.durationDays >= 0.8 ? "warning" : "ok";
    results.push({
      id: "duration",
      status,
      value: day,
      limit: rules.durationDays,
      usage: day / rules.durationDays,
      unit: "days",
    });
  }

  if (rules.maxInactiveDays) {
    // Counted from the last day a position was opened: a pending order that never filled is no trade.
    const value = Math.max(0, daysBetween(input.lastTradingDay ?? profile.startDate, today));
    const usage = value / rules.maxInactiveDays;
    results.push({
      id: "inactivity",
      // While the trading days are still loading, the last one may be missing: no warning from a partial count.
      status: input.tradingDaysPending ? "ok" : limitStatus(usage),
      value,
      limit: rules.maxInactiveDays,
      usage,
      unit: "days",
      ...(input.tradingDaysPending ? { pending: true } : {}),
    });
  }

  return {
    name: profile.name,
    ...(profile.phase ? { phase: profile.phase } : {}),
    day,
    status: overall(results),
    rules: results,
    tradingDayStart: toIsoTime(dayStart),
  };
}

function overall(results: RuleResult[]): ChallengeStatus {
  if (results.some((r) => r.status === "breached")) return "breached";
  const goals = results.filter((r) => r.id === "profitTarget" || r.id === "tradingDays");
  if (goals.length > 0 && goals.every((r) => r.status === "reached")) return "passed";
  // Days without a trade have an alert of their own and no bar: they do not make the challenge "near a limit".
  if (results.some((r) => r.id !== "inactivity" && (r.status === "warning" || r.status === "danger"))) return "warning";
  return "running";
}
