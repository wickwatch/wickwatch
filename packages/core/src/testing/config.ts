import { beforeEach, describe, expect, it } from "vitest";
import type { ConfigAdapter } from "../adapters";
import { ParameterFile, ValidationResult, type ParameterSchema, type ParameterValues } from "../schemas";
import { expectAdapterError, expectSchema } from "./expect-schema";

export interface ConfigContractOptions {
  /** Returns a fresh adapter; called before every test. */
  setup: () => ConfigAdapter | Promise<ConfigAdapter>;
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

    const chart = { symbol: "GER40", period: "h1" };

    it("reads back what it wrote, with the chart", () => {
      const file = adapter.parse(adapter.serialize(options.values, options.schema, chart), options.schema);
      expectSchema(ParameterFile, file);
      expect(file).toEqual({ values: options.values, ...chart, issues: [], unknown: [], missing: [] });
    });

    it("reports parameters the algo does not know or the file does not set", () => {
      const [first, ...rest] = options.schema;
      if (!first) return;
      const extra: ParameterSchema = { name: "WickwatchContractExtra", type: "string" };
      const { [first.name]: _left, ...values } = options.values;
      const content = adapter.serialize({ ...values, [extra.name]: "x" }, [...rest, extra], chart);
      const file = adapter.parse(content, options.schema);
      expect(file.unknown).toEqual([extra.name]);
      expect(file.missing).toEqual([first.name]);
    });

    it("rejects content that is not a parameter file with invalid_input", async () => {
      await expectAdapterError(
        Promise.resolve().then(() => adapter.parse(new Uint8Array(64), options.schema)),
        "invalid_input",
      );
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
