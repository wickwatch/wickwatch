import { describe, expect, it } from "vitest";
import { accountSizeMismatch, applyTemplate, riskPreview, validateParameters, type ParameterSchema } from "../src";

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

describe("accountSizeMismatch", () => {
  it("flags an account size far off the account's, e.g. one zero too many", () => {
    expect(accountSizeMismatch({ Capital: 100_000 }, "Capital", 10_000)).toEqual({
      parameter: "Capital",
      value: 100_000,
      reference: 10_000,
    });
    expect(accountSizeMismatch({ Capital: 5000 }, "Capital", 10_000)).toBeDefined();
  });

  it("accepts values within the tolerance, such as a balance after some losses", () => {
    expect(accountSizeMismatch({ Capital: 10_000 }, "Capital", 9391.37)).toBeUndefined();
    expect(accountSizeMismatch({ Capital: 12_500 }, "Capital", 10_000)).toBeUndefined();
  });

  it("checks nothing without a parameter, a reference or a positive number", () => {
    expect(accountSizeMismatch({ Capital: 100_000 }, undefined, 10_000)).toBeUndefined();
    expect(accountSizeMismatch({ Capital: 100_000 }, "Capital", undefined)).toBeUndefined();
    expect(accountSizeMismatch({ Capital: 0 }, "Capital", 10_000)).toBeUndefined();
    expect(accountSizeMismatch({ Capital: "100000" }, "Capital", 10_000)).toBeUndefined();
    expect(accountSizeMismatch({}, "Capital", 10_000)).toBeUndefined();
  });
});

describe("riskPreview", () => {
  const check = {
    parameter: "Risk",
    currency: "USD",
    sizeParameter: "Capital",
    reference: { value: 10_000, basis: "challengeStart" as const },
    limits: { daily: 500, max: 1000 },
  };

  it("values the risk with the account size parameter and compares it with the loss limits", () => {
    // The incident it is for: a backtest's 100k starting capital on a 10k account.
    expect(riskPreview({ Risk: 1, Capital: 100_000 }, check)).toEqual({
      percent: 1,
      capital: 100_000,
      capitalFrom: "parameter",
      amount: 1000,
      daily: { limit: 500, share: 2 },
      max: { limit: 1000, share: 1 },
      level: "over",
    });
    expect(riskPreview({ Risk: 1, Capital: 10_000 }, check)).toMatchObject({ amount: 100, level: "ok" });
    expect(riskPreview({ Risk: 2.5, Capital: 10_000 }, check)).toMatchObject({ amount: 250, level: "high" });
  });

  it("takes the account's size when the algo names no account size parameter or it is 0", () => {
    expect(riskPreview({ Risk: 1, Capital: 0 }, check)).toMatchObject({ capital: 10_000, capitalFrom: "account" });
    const { sizeParameter: _, ...withoutSize } = check;
    expect(riskPreview({ Risk: 1 }, withoutSize)).toMatchObject({ amount: 100, capitalFrom: "account" });
  });

  it("shows the amount without limits, and nothing without a risk or a capital", () => {
    expect(riskPreview({ Risk: 1 }, { parameter: "Risk", currency: "USD", reference: check.reference })).toEqual({
      percent: 1,
      capital: 10_000,
      capitalFrom: "account",
      amount: 100,
      level: "ok",
    });
    expect(riskPreview({ Risk: 0 }, check)).toBeUndefined();
    expect(riskPreview({ Risk: "1" }, check)).toBeUndefined();
    expect(riskPreview({ Risk: 1 }, { parameter: "Risk", currency: "USD" })).toBeUndefined();
    expect(riskPreview({ Risk: 1 }, undefined)).toBeUndefined();
  });
});
