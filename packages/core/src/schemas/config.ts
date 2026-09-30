import Type from "typebox";

export const ParameterValues = Type.Record(Type.String(), Type.Unknown());
export type ParameterValues = Type.Static<typeof ParameterValues>;

export const ParameterIssueCode = Type.Union([
  /** Empty or missing although the runtime needs a value (see Capabilities.requiresTextValues). */
  Type.Literal("required"),
  Type.Literal("invalid_type"),
  Type.Literal("below_min"),
  Type.Literal("above_max"),
  Type.Literal("invalid_option"),
  Type.Literal("invalid_format"),
]);
export type ParameterIssueCode = Type.Static<typeof ParameterIssueCode>;

/** A single validation problem. `code` maps to an i18n key; no English text here. */
export const ParameterIssue = Type.Object({
  parameter: Type.String(),
  code: ParameterIssueCode,
});
export type ParameterIssue = Type.Static<typeof ParameterIssue>;

export const ValidationResult = Type.Object({
  errors: Type.Array(ParameterIssue),
  /** Values present that the schema does not know. */
  unknown: Type.Array(Type.String()),
  /** Schema parameters without a value; the bot falls back to its default. */
  missing: Type.Array(Type.String()),
});
export type ValidationResult = Type.Static<typeof ValidationResult>;

/** A parameter file read for an algo: values converted to the schema's types, e.g. enum numbers to names. */
export const ParameterFile = Type.Object({
  values: ParameterValues,
  /** The chart the file was saved for, if it says. */
  symbol: Type.Optional(Type.String()),
  period: Type.Optional(Type.String()),
  /** Values the file has but that do not fit the schema; they are left out of `values`. */
  issues: Type.Array(ParameterIssue),
  /** Parameters in the file that the algo does not know; left out. */
  unknown: Type.Array(Type.String()),
  /** Algo parameters the file does not set. */
  missing: Type.Array(Type.String()),
});
export type ParameterFile = Type.Static<typeof ParameterFile>;

export const OptimizationRange = Type.Object({
  min: Type.Number(),
  max: Type.Number(),
  step: Type.Number({ exclusiveMinimum: 0 }),
});
export type OptimizationRange = Type.Static<typeof OptimizationRange>;
