import type { ParameterFile, ParameterIssue, ParameterSchema, ParameterValues, ValidationResult } from "./schemas";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const COLOR = /^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|[A-Za-z]+)$/;

/** Parameter types whose value is text, so it can be empty. */
const TEXT_TYPES = new Set<ParameterSchema["type"]>(["string", "symbol", "period", "time", "color"]);

export interface ValidateOptions {
  /** Empty or missing text parameters are errors ("required"), for runtimes without an empty value. */
  requireText?: boolean;
}

/** Checks parameter values against an algo's parameter schema. Format-independent. */
export function validateParameters(
  values: ParameterValues,
  schema: ParameterSchema[],
  options: ValidateOptions = {},
): ValidationResult {
  const known = new Set(schema.map((p) => p.name));
  const errors: ParameterIssue[] = [];
  const missing: string[] = [];

  for (const param of schema) {
    if (options.requireText && TEXT_TYPES.has(param.type) && (values[param.name] ?? "") === "") {
      errors.push({ parameter: param.name, code: "required" });
      continue;
    }
    if (!Object.hasOwn(values, param.name)) {
      missing.push(param.name);
      continue;
    }
    const code = checkValue(values[param.name], param);
    if (code) errors.push({ parameter: param.name, code });
  }

  const unknown = Object.keys(values).filter((name) => !known.has(name));
  return { errors, unknown, missing };
}

function checkValue(value: unknown, param: ParameterSchema): ParameterIssue["code"] | undefined {
  switch (param.type) {
    case "int":
    case "double": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "invalid_type";
      if (param.type === "int" && !Number.isInteger(value)) return "invalid_type";
      if (param.min !== undefined && value < param.min) return "below_min";
      if (param.max !== undefined && value > param.max) return "above_max";
      return undefined;
    }
    case "bool":
      return typeof value === "boolean" ? undefined : "invalid_type";
    case "enum":
      if (typeof value !== "string") return "invalid_type";
      return param.options?.includes(value) ? undefined : "invalid_option";
    case "time":
      if (typeof value !== "string") return "invalid_type";
      return TIME_OF_DAY.test(value) ? undefined : "invalid_format";
    case "color":
      if (typeof value !== "string") return "invalid_type";
      return COLOR.test(value) ? undefined : "invalid_format";
    case "string":
    case "symbol":
    case "period":
      return typeof value === "string" ? undefined : "invalid_type";
  }
}

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/**
 * Converts the values of a parameter file to the schema's types. Files may store every value as text
 * ("True", "1.5") and enums as numbers (`optionValues`, else the option's position). A decimal comma is
 * not guessed at: it is reported, like anything else that does not fit.
 */
export function valuesFromFile(
  raw: Record<string, unknown>,
  schema: ParameterSchema[],
): Omit<ParameterFile, "symbol" | "period"> {
  const values: ParameterValues = {};
  const issues: ParameterIssue[] = [];
  const known = new Set(schema.map((p) => p.name));
  for (const param of schema) {
    if (!Object.hasOwn(raw, param.name)) continue;
    const value = fromFile(raw[param.name], param);
    if (value === undefined) issues.push({ parameter: param.name, code: "invalid_type" });
    else {
      const code = validateParameters({ [param.name]: value }, [param]).errors[0]?.code;
      if (code) issues.push({ parameter: param.name, code });
      else values[param.name] = value;
    }
  }
  return {
    values,
    issues,
    unknown: Object.keys(raw).filter((name) => !known.has(name)),
    missing: schema.filter((p) => !Object.hasOwn(raw, p.name)).map((p) => p.name),
  };
}

function fromFile(value: unknown, param: ParameterSchema): unknown {
  const text = typeof value === "string" ? value.trim() : undefined;
  switch (param.type) {
    case "int":
    case "double":
      if (typeof value === "number") return value;
      return text !== undefined && NUMBER.test(text) ? Number(text) : undefined;
    case "bool":
      if (typeof value === "boolean") return value;
      return text?.toLowerCase() === "true" ? true : text?.toLowerCase() === "false" ? false : undefined;
    case "enum": {
      const options = param.options ?? [];
      if (text !== undefined && options.includes(text)) return text;
      const n = typeof value === "number" ? value : text !== undefined && NUMBER.test(text) ? Number(text) : undefined;
      if (n === undefined) return undefined;
      const at = param.optionValues ? param.optionValues.indexOf(n) : Number.isInteger(n) ? n : -1;
      return options[at];
    }
    default:
      return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
  }
}

/** The number a platform stores for an enum option (`optionValues`, else the option's position). */
export function enumNumber(param: ParameterSchema, option: unknown): number | undefined {
  const at = param.options?.indexOf(String(option)) ?? -1;
  if (at < 0) return undefined;
  return param.optionValues ? param.optionValues[at] : at;
}

/** The defaults of a schema, for the parameters that have one. */
export function parameterDefaults(schema: ParameterSchema[]): ParameterValues {
  return Object.fromEntries(schema.filter((p) => p.default !== undefined).map((p) => [p.name, p.default]));
}

export interface TemplateResult {
  /** The values to save: the template's where they fit the algo, the current ones elsewhere. */
  values: ParameterValues;
  /** Parameters whose value the template changes. */
  changed: string[];
  /** Template values that do not fit this algo version (e.g. out of range); the current value stays. */
  rejected: ParameterIssue[];
  /** Template values the algo does not know; left out. */
  unknown: string[];
  /** Algo parameters the template does not set (e.g. added in a newer version); the current value stays. */
  kept: string[];
}

/**
 * Applies a parameter template to an instance's current values. Only what fits the algo's schema is taken, so a
 * template saved with another version of the algo never breaks a configuration; the rest is reported.
 */
export function applyTemplate(
  current: ParameterValues,
  template: ParameterValues,
  schema: ParameterSchema[],
  options: ValidateOptions = {},
): TemplateResult {
  const values: ParameterValues = { ...current };
  const changed: string[] = [];
  const rejected: ParameterIssue[] = [];
  const kept: string[] = [];
  for (const param of schema) {
    if (!Object.hasOwn(template, param.name)) {
      kept.push(param.name);
      continue;
    }
    const value = template[param.name];
    const code = validateParameters({ [param.name]: value }, [param], options).errors[0]?.code;
    if (code) rejected.push({ parameter: param.name, code });
    else {
      if (current[param.name] !== value) changed.push(param.name);
      values[param.name] = value;
    }
  }
  const known = new Set(schema.map((p) => p.name));
  return { values, changed, rejected, unknown: Object.keys(template).filter((n) => !known.has(n)), kept };
}
