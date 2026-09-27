import Type from "typebox";
import { IsoTime } from "./common";

// Prop-challenge rules, templates and evaluation. Firm-neutral: every value comes from a template or the user.

export const DayDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
export type DayDate = Type.Static<typeof DayDate>;

export const TimeOfDay = Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" });

export const DailyLossReference = Type.Union([
  Type.Literal("balance-or-equity-at-day-start"),
  Type.Literal("balance-at-day-start"),
  Type.Literal("equity-at-day-start"),
]);
export type DailyLossReference = Type.Static<typeof DailyLossReference>;

export const ChallengeRules = Type.Object({
  /** 0 or missing: no profit target. */
  profitTargetPct: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
  dailyLoss: Type.Optional(
    Type.Object({
      limitPct: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
      reference: DailyLossReference,
      /** Local time when the trading day starts, e.g. "00:00". */
      resetTime: TimeOfDay,
      /** IANA time zone of the reset, e.g. "Europe/Prague". */
      timezone: Type.String({ minLength: 1 }),
      /** The limit is a percentage of the initial balance (default) or of the day-start reference. */
      limitBasis: Type.Optional(Type.Union([Type.Literal("initial-balance"), Type.Literal("day-start")])),
    }),
  ),
  maxLoss: Type.Optional(
    Type.Object({
      limitPct: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
      /** static: from the initial balance; trailing: from the highest equity recorded. */
      type: Type.Union([Type.Literal("static"), Type.Literal("trailing")]),
    }),
  ),
  minTradingDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
  durationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 3650 }), Type.Null()])),
});
export type ChallengeRules = Type.Static<typeof ChallengeRules>;

/** A JSON file in templates/challenges/; see its README. */
export const ChallengeTemplate = Type.Intersect([
  ChallengeRules,
  Type.Object({
    id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" }),
    firm: Type.String({ minLength: 1 }),
    program: Type.String({ minLength: 1 }),
    phase: Type.String({ minLength: 1 }),
    /** Display name per locale, e.g. { "en": "…", "de": "…" }. */
    name: Type.Record(Type.String(), Type.String()),
    tradingDayDefinition: Type.Optional(Type.String()),
    source: Type.String({ minLength: 1 }),
    asOf: Type.String({ minLength: 1 }),
  }),
]);
export type ChallengeTemplate = Type.Static<typeof ChallengeTemplate>;

export const ChallengeProfile = Type.Object({
  templateId: Type.Optional(Type.String()),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  phase: Type.Optional(Type.String({ maxLength: 100 })),
  startDate: DayDate,
  startBalance: Type.Number({ exclusiveMinimum: 0 }),
  rules: ChallengeRules,
});
export type ChallengeProfile = Type.Static<typeof ChallengeProfile>;

export const RuleId = Type.Union([
  Type.Literal("profitTarget"),
  Type.Literal("dailyLoss"),
  Type.Literal("maxLoss"),
  Type.Literal("tradingDays"),
  Type.Literal("duration"),
]);
export type RuleId = Type.Static<typeof RuleId>;

/**
 * Limits: ok < 50 % used ≤ warning < 80 % ≤ danger < 100 % ≤ breached.
 * Goals (profit target, trading days): open until reached.
 */
export const RuleStatus = Type.Union([
  Type.Literal("ok"),
  Type.Literal("warning"),
  Type.Literal("danger"),
  Type.Literal("breached"),
  Type.Literal("open"),
  Type.Literal("reached"),
]);
export type RuleStatus = Type.Static<typeof RuleStatus>;

export const RuleResult = Type.Object({
  id: RuleId,
  status: RuleStatus,
  /** Percent for money rules, days for day rules. */
  value: Type.Number(),
  limit: Type.Number(),
  /** value / limit, not capped. */
  usage: Type.Number(),
  unit: Type.Union([Type.Literal("percent"), Type.Literal("days")]),
  /** Based on an estimate, e.g. day-start equity was not recorded at the reset. */
  approximate: Type.Optional(Type.Boolean()),
});
export type RuleResult = Type.Static<typeof RuleResult>;

export const ChallengeStatus = Type.Union([
  Type.Literal("running"),
  Type.Literal("warning"),
  Type.Literal("breached"),
  Type.Literal("passed"),
]);
export type ChallengeStatus = Type.Static<typeof ChallengeStatus>;

export const ChallengeEvaluation = Type.Object({
  name: Type.String(),
  phase: Type.Optional(Type.String()),
  /** 1 on the start date. */
  day: Type.Integer({ minimum: 1 }),
  status: ChallengeStatus,
  rules: Type.Array(RuleResult),
  /** Start of the current trading day (UTC). */
  tradingDayStart: IsoTime,
});
export type ChallengeEvaluation = Type.Static<typeof ChallengeEvaluation>;
