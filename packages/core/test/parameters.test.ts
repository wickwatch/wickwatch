import { describe, expect, it } from "vitest";
import { applyTemplate, validateParameters, type ParameterSchema } from "../src";

const schema: ParameterSchema[] = [
  { name: "Risk", type: "double", min: 0.1, max: 2 },
  { name: "Lookback", type: "int", min: 1 },
  { name: "UseFilter", type: "bool" },
  { name: "Mode", type: "enum", options: ["Fast", "Slow"] },
  { name: "SessionStart", type: "time" },
  { name: "Symbol", type: "symbol" },
];

const valid = { Risk: 0.5, Lookback: 20, UseFilter: true, Mode: "Fast", SessionStart: "08:00", Symbol: "EURUSD" };

describe("validateParameters", () => {
  it("accepts valid values", () => {
    expect(validateParameters(valid, schema)).toEqual({ errors: [], unknown: [], missing: [] });
  });

  it("requires text values when the runtime has no empty text, and only then", () => {
    const text: ParameterSchema[] = [...schema, { name: "Token", type: "string" }, { name: "Note", type: "string" }];
    const values = { ...valid, SessionStart: "", Token: "" };
    // Note is missing, Token and SessionStart are empty; numbers, bools and enums are not affected.
    expect(validateParameters(values, text, { requireText: true })).toEqual({
      errors: [
        { parameter: "SessionStart", code: "required" },
        { parameter: "Token", code: "required" },
        { parameter: "Note", code: "required" },
      ],
      unknown: [],
      missing: [],
    });
    expect(validateParameters({ ...values, SessionStart: "08:00" }, text).errors).toEqual([]);
  });

  it("reports unknown and missing parameters", () => {
    const { Mode: _, ...rest } = valid;
    expect(validateParameters({ ...rest, Extra: 1 }, schema)).toEqual({
      errors: [],
      unknown: ["Extra"],
      missing: ["Mode"],
    });
  });

  it.each([
    ["Risk", "0.5", "invalid_type"],
    ["Risk", 0.05, "below_min"],
    ["Risk", 3, "above_max"],
    ["Risk", Number.NaN, "invalid_type"],
    ["Lookback", 1.5, "invalid_type"],
    ["UseFilter", "true", "invalid_type"],
    ["Mode", "Medium", "invalid_option"],
    ["SessionStart", "8:00", "invalid_format"],
    ["SessionStart", "24:00", "invalid_format"],
    ["Symbol", 42, "invalid_type"],
  ])("flags %s = %j as %s", (parameter, value, code) => {
    expect(validateParameters({ ...valid, [parameter]: value }, schema).errors).toEqual([{ parameter, code }]);
  });

  it("accepts colours as #AARRGGBB, #RRGGBB or a name, as `run` does", () => {
    const schema = [{ name: "LineColor", type: "color" as const }];
    for (const ok of ["#FFFF0000", "#00ff00", "Blue"]) {
      expect(validateParameters({ LineColor: ok }, schema).errors, ok).toEqual([]);
    }
    expect(validateParameters({ LineColor: "#FFF" }, schema).errors).toEqual([
      { parameter: "LineColor", code: "invalid_format" },
    ]);
    expect(validateParameters({ LineColor: { A: 255 } }, schema).errors[0]?.code).toBe("invalid_type");
  });
});

describe("applyTemplate", () => {
  it("takes the template's values that fit and keeps the current ones elsewhere", () => {
    const current = { ...valid, Lookback: 50 };
    const template = { Risk: 1, Lookback: 50, UseFilter: false, Mode: "Turbo", Retired: 3 };
    expect(applyTemplate(current, template, schema)).toEqual({
      values: { ...valid, Risk: 1, Lookback: 50, UseFilter: false },
      changed: ["Risk", "UseFilter"],
      rejected: [{ parameter: "Mode", code: "invalid_option" }],
      unknown: ["Retired"],
      kept: ["SessionStart", "Symbol"],
    });
  });

  it("rejects empty text where the runtime needs a value", () => {
    const result = applyTemplate(valid, { Symbol: "" }, schema, { requireText: true });
    expect(result.rejected).toEqual([{ parameter: "Symbol", code: "required" }]);
    expect(result.values["Symbol"]).toBe("EURUSD");
    expect(applyTemplate(valid, { Symbol: "" }, schema).values["Symbol"]).toBe("");
  });
});
