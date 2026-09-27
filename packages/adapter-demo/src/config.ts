import {
  AdapterError,
  validateParameters,
  type ConfigAdapter,
  type ParameterSchema,
  type ParameterValues,
  type ValidationResult,
} from "@wickwatch/core";
import type { DemoWorld } from "./world";

/** Keeps parameter sets in memory as plain JSON objects. */
export class DemoConfigAdapter implements ConfigAdapter {
  readonly id = "demo";

  constructor(private readonly world: DemoWorld) {}

  formats(): string[] {
    return ["json"];
  }

  async read(path: string): Promise<ParameterValues> {
    const values = this.world.files.get(path);
    if (!values) throw new AdapterError("not_found", `Unknown demo parameter file ${path}`);
    return structuredClone(values);
  }

  async write(path: string, values: ParameterValues): Promise<void> {
    this.world.files.set(path, structuredClone(values));
  }

  validate(values: ParameterValues, schema: ParameterSchema[]): ValidationResult {
    return validateParameters(values, schema);
  }
}
