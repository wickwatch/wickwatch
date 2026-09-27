import { beforeEach, describe, expect, it } from "vitest";
import type { ConfigAdapter } from "../adapters";
import { ValidationResult, type ParameterSchema, type ParameterValues } from "../schemas";
import { expectAdapterError, expectSchema } from "./expect-schema";

export interface ConfigContractOptions {
  /** Returns a fresh adapter; called before every test. */
  setup: () => ConfigAdapter | Promise<ConfigAdapter>;
  /** A writable path for the round-trip test. */
  path: string;
  /** Valid values for `schema`, covering every parameter type the format supports. */
  values: ParameterValues;
  schema: ParameterSchema[];
}

export function describeConfigAdapter(name: string, options: ConfigContractOptions): void {
  describe(`ConfigAdapter contract: ${name}`, () => {
    let adapter: ConfigAdapter;
    beforeEach(async () => {
      adapter = await options.setup();
    });

    it("declares at least one format", () => {
      expect(adapter.id).toMatch(/\S/);
      expect(adapter.formats().length).toBeGreaterThan(0);
    });

    it("reads back what it wrote", async () => {
      await adapter.write(options.path, options.values);
      expect(await adapter.read(options.path)).toEqual(options.values);
    });

    it("rejects reading a missing file with not_found", async () => {
      await expectAdapterError(adapter.read(`${options.path}.missing`), "not_found");
    });

    it("accepts the valid values", () => {
      const result = adapter.validate(options.values, options.schema);
      expectSchema(ValidationResult, result);
      expect(result).toEqual({ errors: [], unknown: [], missing: [] });
    });

    it("reports unknown, missing and invalid values", () => {
      const [first, ...rest] = options.schema;
      if (!first) return;
      const values: ParameterValues = { wickwatchContractUnknown: 1 };
      for (const param of rest) values[param.name] = options.values[param.name];
      values[first.name] = Symbol("invalid");
      const result = adapter.validate(values, options.schema);
      expect(result.unknown).toEqual(["wickwatchContractUnknown"]);
      expect(result.errors.map((e) => e.parameter)).toEqual([first.name]);

      const { [first.name]: _invalid, ...withoutFirst } = values;
      expect(adapter.validate(withoutFirst, options.schema).missing).toEqual([first.name]);
    });
  });
}
