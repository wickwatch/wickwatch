import Type from "typebox";

export const ParameterValues = Type.Record(Type.String(), Type.Unknown());
export type ParameterValues = Type.Static<typeof ParameterValues>;

export const ParameterIssueCode = Type.Union([
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

export const OptimizationRange = Type.Object({
  min: Type.Number(),
  max: Type.Number(),
  step: Type.Number({ exclusiveMinimum: 0 }),
});
export type OptimizationRange = Type.Static<typeof OptimizationRange>;
