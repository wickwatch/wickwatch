import type { ParameterIssue, ParameterSchema, ParameterValues, ValidationResult } from "./schemas";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Checks parameter values against an algo's parameter schema. Format-independent. */
export function validateParameters(values: ParameterValues, schema: ParameterSchema[]): ValidationResult {
  const known = new Set(schema.map((p) => p.name));
  const errors: ParameterIssue[] = [];
  const missing: string[] = [];

  for (const param of schema) {
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
    case "string":
    case "symbol":
    case "period":
      return typeof value === "string" ? undefined : "invalid_type";
  }
}
