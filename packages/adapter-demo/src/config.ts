import {
  AdapterError,
  validateParameters,
  valuesFromFile,
  type ConfigAdapter,
  type ParameterFile,
  type ParameterSchema,
  type ParameterValues,
  type ValidationResult,
} from "@wickwatch/core";

/** Parameter files as plain JSON: `{ "chart": { "symbol", "period" }, "parameters": { … } }`. */
export class DemoConfigAdapter implements ConfigAdapter {
  readonly id = "demo";

  formats(): string[] {
    return ["json"];
  }

  parse(content: Uint8Array, schema: ParameterSchema[]): ParameterFile {
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(content));
    } catch (error) {
      throw new AdapterError("invalid_input", "Not a JSON parameter file", { cause: error });
    }
    const file = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const parameters = file["parameters"];
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
      throw new AdapterError("invalid_input", "The file has no parameters");
    }
    const chart = (file["chart"] ?? {}) as Record<string, unknown>;
    return {
      ...valuesFromFile(parameters as Record<string, unknown>, schema),
      ...(typeof chart["symbol"] === "string" ? { symbol: chart["symbol"] } : {}),
      ...(typeof chart["period"] === "string" ? { period: chart["period"] } : {}),
    };
  }

  serialize(values: ParameterValues, schema: ParameterSchema[], chart: { symbol: string; period: string }): Uint8Array {
    const parameters = Object.fromEntries(schema.filter((p) => p.name in values).map((p) => [p.name, values[p.name]]));
    return new TextEncoder().encode(`${JSON.stringify({ chart, parameters }, null, 2)}\n`);
  }

  validate(values: ParameterValues, schema: ParameterSchema[]): ValidationResult {
    return validateParameters(values, schema);
  }
}
