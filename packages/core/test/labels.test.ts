import { describe, expect, it } from "vitest";
import { buildLabels, readLabels } from "../src";

describe("labels", () => {
  it("builds prefixed labels and reads them back", () => {
    const labels = buildLabels("acme", { instance: "alpha-1", symbol: "GER40" });
    expect(labels).toEqual({ "acme.instance": "alpha-1", "acme.symbol": "GER40" });
    expect(readLabels("acme", { ...labels, "other.instance": "x" })).toEqual({ instance: "alpha-1", symbol: "GER40" });
  });
});
