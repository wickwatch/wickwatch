import type { ParameterSchema } from "@wickwatch/core";
import { describeConfigAdapter } from "@wickwatch/core/testing";
import { describe, expect, it } from "vitest";
import { CbotsetConfigAdapter } from "../src";

// Shapes as found in files written by cTrader Desktop (2026-09); values made up.
const schema: ParameterSchema[] = [
  { name: "RiskPercent", type: "double", min: 0.1, max: 5 },
  { name: "AtrPeriod", type: "int" },
  { name: "DailyGuardEnabled", type: "bool" },
  { name: "TradeDirection", type: "enum", options: ["Long", "Short", "Beide"], optionValues: [0, 1, 2] },
  { name: "Mode", type: "enum", options: ["A", "B"] },
  { name: "SessionEnd", type: "time" },
  { name: "Tag", type: "string" },
];

const encode = (text: string) => new TextEncoder().encode(text);
const adapter = new CbotsetConfigAdapter();

describeConfigAdapter("cbotset", {
  setup: () => new CbotsetConfigAdapter(),
  values: {
    RiskPercent: 1.5,
    AtrPeriod: 14,
    DailyGuardEnabled: true,
    TradeDirection: "Beide",
    Mode: "B",
    SessionEnd: "22:00",
    Tag: "US30_V3_M30",
  },
  schema,
});

describe("cbotset", () => {
  it("reads an export with byte order mark, typed values and enums as numbers", () => {
    const file = `\uFEFF${JSON.stringify(
      {
        Chart: { Symbol: "US30.cash", Period: "m30" },
        Parameters: { RiskPercent: 1.0, AtrPeriod: 14, DailyGuardEnabled: true, TradeDirection: 2, Mode: 1, Tag: "x" },
      },
      null,
      2,
    )}`;
    expect(adapter.parse(encode(file), schema)).toEqual({
      values: { RiskPercent: 1, AtrPeriod: 14, DailyGuardEnabled: true, TradeDirection: "Beide", Mode: "B", Tag: "x" },
      symbol: "US30.cash",
      period: "m30",
      issues: [],
      unknown: [],
      missing: ["SessionEnd"],
    });
  });

  it("reads the backtest files that store every value as text", () => {
    const file = JSON.stringify({
      Chart: { Symbol: "GER40", Period: "h1" },
      Parameters: {
        RiskPercent: "0.75",
        AtrPeriod: "20",
        DailyGuardEnabled: "False",
        TradeDirection: "0",
        Mode: "A",
        SessionEnd: "22:00:00",
        Tag: "",
        LicenseKey: "not for this algo",
      },
    });
    expect(adapter.parse(encode(file), schema)).toEqual({
      values: {
        RiskPercent: 0.75,
        AtrPeriod: 20,
        DailyGuardEnabled: false,
        TradeDirection: "Long",
        Mode: "A",
        SessionEnd: "22:00:00",
        Tag: "",
      },
      symbol: "GER40",
      period: "h1",
      issues: [],
      unknown: ["LicenseKey"],
      missing: [],
    });
  });

  it("reports values that do not fit instead of guessing, and leaves them out", () => {
    const file = JSON.stringify({
      Chart: { Symbol: "GER40", Period: "h1" },
      Parameters: {
        RiskPercent: "1,5",
        AtrPeriod: 14.5,
        TradeDirection: 7,
        DailyGuardEnabled: "ja",
        SessionEnd: "25:00",
      },
    });
    const parsed = adapter.parse(encode(file), schema);
    expect(parsed.issues).toEqual([
      { parameter: "RiskPercent", code: "invalid_type" },
      { parameter: "AtrPeriod", code: "invalid_type" },
      { parameter: "DailyGuardEnabled", code: "invalid_type" },
      { parameter: "TradeDirection", code: "invalid_type" },
      { parameter: "SessionEnd", code: "invalid_format" },
    ]);
    expect(parsed.values).toEqual({});
  });

  it("writes typed values and enum numbers with a byte order mark, like an export", () => {
    const bytes = adapter.serialize({ RiskPercent: 1.5, TradeDirection: "Short", Mode: "B" }, schema, {
      symbol: "US30.cash",
      period: "m30",
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder drops the byte order mark itself.
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
      Chart: { Symbol: "US30.cash", Period: "m30" },
      Parameters: { RiskPercent: 1.5, TradeDirection: 1, Mode: 1 },
    });
  });

  it("rejects files that are no .cbotset", () => {
    expect(() => adapter.parse(new Uint8Array([0, 0, 0]), schema)).toThrow(/no JSON/);
    expect(() => adapter.parse(encode('{"Chart":{}}'), schema)).toThrow(/no Parameters/);
  });
});
