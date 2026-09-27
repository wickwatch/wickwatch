import { describe, expect, it } from "vitest";
import { buildLabels, createAttributor, type LabelValues, type RuntimeInstance } from "../src";

const instance = (values: LabelValues): RuntimeInstance => ({
  ref: `ww-${values.instance ?? "x"}`,
  labels: buildLabels("ww", values),
  status: "running",
  restartCount: 0,
});

describe("createAttributor", () => {
  it("auto: uses the label, else takes every trade on its symbol when it is alone there", () => {
    const a = createAttributor([instance({ instance: "orb", account: "1", symbol: "US100.cash" })], "ww");
    expect(a.owner("1", { label: "orb", symbol: "US100.cash" })).toBe("orb");
    // Third-party bot with its own numeric labels.
    expect(a.owner("1", { label: "123456789", symbol: "us100.CASH" })).toBe("orb");
    expect(a.owner("1", { symbol: "US100.cash" })).toBe("orb");
    expect(a.owner("1", { label: "123", symbol: "GER40" })).toBeUndefined();
    expect(a.owner("2", { label: "orb", symbol: "US100.cash" })).toBeUndefined();
    expect(a.problems).toEqual([]);
  });

  it("auto: with two bots on one account and symbol only labels decide", () => {
    const a = createAttributor(
      [
        instance({ instance: "a", account: "1", symbol: "GER40" }),
        instance({ instance: "b", account: "1", symbol: "GER40" }),
      ],
      "ww",
    );
    expect(a.owner("1", { label: "b", symbol: "GER40" })).toBe("b");
    expect(a.owner("1", { label: "123", symbol: "GER40" })).toBeUndefined();
    expect(a.problems).toEqual([]);
  });

  it("label: never falls back to the symbol; the expected label can differ from the name", () => {
    const a = createAttributor(
      [instance({ instance: "orb", account: "1", symbol: "GER40", attribution: "label", "order-label": "ORB-1" })],
      "ww",
    );
    expect(a.owner("1", { label: "ORB-1", symbol: "GER40" })).toBe("orb");
    expect(a.owner("1", { label: "orb", symbol: "GER40" })).toBeUndefined();
    expect(a.owner("1", { symbol: "GER40" })).toBeUndefined();
  });

  it("label-pattern: matches the label with a regular expression", () => {
    const a = createAttributor(
      [
        instance({
          instance: "old",
          account: "1",
          symbol: "US100",
          attribution: "label-pattern",
          "order-label": "^\\d{9}$",
        }),
        instance({
          instance: "new",
          account: "1",
          symbol: "US100",
          attribution: "label-pattern",
          "order-label": "^NEW-",
        }),
      ],
      "ww",
    );
    expect(a.owner("1", { label: "123456789", symbol: "US100" })).toBe("old");
    expect(a.owner("1", { label: "NEW-7", symbol: "US100" })).toBe("new");
    expect(a.owner("1", { label: "manual", symbol: "US100" })).toBeUndefined();
  });

  it("account-symbol: takes everything on the symbol, and reports a clash with another instance", () => {
    const a = createAttributor(
      [
        instance({ instance: "x", account: "1", symbol: "GER40", attribution: "account-symbol" }),
        instance({ instance: "y", account: "1", symbol: "GER40" }),
      ],
      "ww",
    );
    expect(a.owner("1", { label: "y", symbol: "GER40" })).toBe("y");
    expect(a.owner("1", { label: "z", symbol: "GER40" })).toBeUndefined();
    expect(a.problems).toEqual([{ kind: "ambiguous", account: "1", symbol: "GER40", instances: ["x", "y"] }]);
  });

  it("reports an invalid pattern and does not match with it", () => {
    const a = createAttributor(
      [instance({ instance: "bad", account: "1", symbol: "GER40", attribution: "label-pattern", "order-label": "(" })],
      "ww",
    );
    expect(a.owner("1", { label: "(", symbol: "GER40" })).toBeUndefined();
    expect(a.problems).toEqual([{ kind: "invalid", account: "1", instances: ["bad"] }]);
  });
});
