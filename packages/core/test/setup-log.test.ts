import { describe, expect, it } from "vitest";
import { parseSetupLine } from "../src";

describe("parseSetupLine", () => {
  it("parses the JSON payload", () => {
    const line = 'WW-SETUP {"label":"alpha","positionId":"1","features":{"atr":38.2}}';
    expect(parseSetupLine(line)).toEqual({ label: "alpha", positionId: "1", features: { atr: 38.2 } });
  });

  it("finds the prefix after a log timestamp", () => {
    expect(parseSetupLine('12:00:01.123 | Info | WW-SETUP {"signal":"long"}')).toEqual({ signal: "long" });
  });

  it.each(["Position opened", "WW-SETUP {broken", "WW-SETUP [1,2]", "WW-SETUP"])("ignores %j", (line) => {
    expect(parseSetupLine(line)).toBeUndefined();
  });
});
