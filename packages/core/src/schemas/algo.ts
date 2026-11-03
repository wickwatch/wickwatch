import Type from "typebox";
import { ParameterSchema } from "./broker";

/** An uploaded algo version. */
export const Algo = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  version: Type.String(),
  sha256: Type.String(),
  size: Type.Integer(),
  buildTime: Type.Optional(Type.String()),
  fullAccess: Type.Boolean(),
  parameters: Type.Array(ParameterSchema),
  uploadedAt: Type.String(),
});
export type Algo = Type.Static<typeof Algo>;

/**
 * What wickwatch does when a line in the log of one of the algo's running instances matches `pattern`: restart or stop
 * the instance. With `recoveryPattern` only if no line matching that follows within `waitSeconds` (e.g. the bot reports
 * it is fine again). `cooldownMinutes` and `maxPerDay` (per instance and rule) keep a bot that keeps writing the line
 * from being restarted over and over; once the limit is reached, an alert says so instead.
 */
export const LogRule = Type.Object({
  /** Text the line contains (any case), or a regular expression if `regex`; the same for `recoveryPattern`. */
  pattern: Type.String({ minLength: 1, maxLength: 300 }),
  regex: Type.Boolean(),
  recoveryPattern: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  waitSeconds: Type.Integer({ minimum: 10, maximum: 3600 }),
  action: Type.Union([Type.Literal("restart"), Type.Literal("stop")]),
  /** Also while the instance has an open position; otherwise an alert says why nothing was done. */
  withOpenPosition: Type.Boolean(),
  cooldownMinutes: Type.Integer({ minimum: 1, maximum: 1440 }),
  maxPerDay: Type.Integer({ minimum: 1, maximum: 50 }),
});
export type LogRule = Type.Static<typeof LogRule>;

/** Settings of an algo, by its name: they hold for all its versions. */
export const AlgoSettings = Type.Object({
  algoName: Type.String(),
  /**
   * The parameter holding the account size the algo calculates with, e.g. a starting capital; checked against the
   * account's (challenge start balance, else balance) so a wrong value is noticed before it trades.
   */
  accountSizeParameter: Type.Optional(Type.String()),
  /**
   * The parameter holding the risk per trade in percent of the algo's capital (the account size parameter, else the
   * account's size); wickwatch shows it in money and against the challenge's loss limits.
   */
  riskParameter: Type.Optional(Type.String()),
  /** Restart or stop an instance when its log says so; instances can opt out (ManagedInstance.logRules). */
  logRules: Type.Optional(Type.Array(LogRule)),
});
export type AlgoSettings = Type.Static<typeof AlgoSettings>;

const SettingParameter = Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]);

/** Fields left out stay as they are; null switches one off. */
export const AlgoSettingsInput = Type.Object({
  accountSizeParameter: Type.Optional(SettingParameter),
  riskParameter: Type.Optional(SettingParameter),
  /** Replaces the rules; an empty list removes them. */
  logRules: Type.Optional(Type.Array(LogRule, { maxItems: 20 })),
});
export type AlgoSettingsInput = Type.Static<typeof AlgoSettingsInput>;
