import type {
  ChallengeEvaluation,
  ChallengeProfile,
  ChallengeRules,
  ChallengeStatus,
  RuleResult,
  RuleStatus,
} from "./schemas";
import { toIsoTime } from "./schemas";
import { daysBetween, tradingDayKey, tradingDayStart } from "./trading-day";

/** Day-start equity counts as recorded only if the first sample of the day came this soon after the reset. */
const DAY_START_TOLERANCE_MS = 5 * 60 * 1000;

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
  /** Days with at least one closed trade since the start. */
  tradingDays: number;
}

/** Reset time and zone of the profile's trading day; UTC midnight without a daily-loss rule. */
export function profileDay(rules: ChallengeRules): { resetTime: string; timeZone: string } {
  return { resetTime: rules.dailyLoss?.resetTime ?? "00:00", timeZone: rules.dailyLoss?.timezone ?? "UTC" };
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

  if (rules.dailyLoss) {
    const dayStartBalance = balance - input.realizedToday;
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
    const base =
      rules.maxLoss.type === "trailing" ? Math.max(startBalance, input.peakEquity ?? startBalance) : startBalance;
    const value = round(pct(Math.max(0, base - dayLow), base));
    const usage = value / rules.maxLoss.limitPct;
    results.push({
      id: "maxLoss",
      status: limitStatus(usage),
      value,
      limit: rules.maxLoss.limitPct,
      usage,
      unit: "percent",
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
  if (results.some((r) => r.status === "warning" || r.status === "danger")) return "warning";
  return "running";
}
