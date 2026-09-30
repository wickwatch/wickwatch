// Config adapter for cTrader parameter files (.cbotset): read uploads for an algo, write downloads.
import {
  AdapterError,
  enumNumber,
  validateParameters,
  type ValidateOptions,
  valuesFromFile,
  type ConfigAdapter,
  type ParameterFile,
  type ParameterSchema,
  type ParameterValues,
  type ValidationResult,
} from "@wickwatch/core";

const BOM = "\uFEFF";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `.cbotset` as cTrader writes it: JSON `{ "Chart": { "Symbol", "Period" }, "Parameters": { … } }`,
 * sometimes with a byte order mark. Exports store typed values; the files cTrader keeps for its own
 * backtests store every value as text ("True", "1.5", "22:00:00"). Enums are numbers in both.
 */
export class CbotsetConfigAdapter implements ConfigAdapter {
  readonly id = "cbotset";

  formats(): string[] {
    return ["cbotset"];
  }

  parse(content: Uint8Array, schema: ParameterSchema[]): ParameterFile {
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content).replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new AdapterError("invalid_input", "Not a .cbotset file (no JSON)", { cause: error });
    }
    if (!isObject(data) || !isObject(data["Parameters"])) {
      throw new AdapterError("invalid_input", "Not a .cbotset file (no Parameters)");
    }
    const chart = isObject(data["Chart"]) ? data["Chart"] : {};
    return {
      ...valuesFromFile(data["Parameters"], schema),
      ...(typeof chart["Symbol"] === "string" ? { symbol: chart["Symbol"] } : {}),
      ...(typeof chart["Period"] === "string" ? { period: chart["Period"] } : {}),
    };
  }

  /** Typed values like a cTrader export; enums as their numbers. Parameters without a value are left out. */
  serialize(values: ParameterValues, schema: ParameterSchema[], chart: { symbol: string; period: string }): Uint8Array {
    const parameters: Json = {};
    for (const param of schema) {
      if (!Object.hasOwn(values, param.name)) continue;
      const value = values[param.name];
      parameters[param.name] = param.type === "enum" ? (enumNumber(param, value) ?? value) : value;
    }
    const file = { Chart: { Symbol: chart.symbol, Period: chart.period }, Parameters: parameters };
    return new TextEncoder().encode(`${BOM}${JSON.stringify(file, null, 2)}`);
  }

  validate(values: ParameterValues, schema: ParameterSchema[], options?: ValidateOptions): ValidationResult {
    return validateParameters(values, schema, options);
  }
}
