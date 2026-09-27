import type { ChallengeEvaluation } from "@wickwatch/core";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ChallengeRules from "../src/components/ChallengeRules.vue";
import { formatPercentValue } from "../src/format";
import { i18n, setLocale } from "../src/i18n";

const challenge = (overrides: Partial<ChallengeEvaluation> = {}): ChallengeEvaluation => ({
  name: "Prop A",
  phase: "Phase 1",
  day: 6,
  status: "running",
  tradingDayStart: "2026-09-24T22:00:00.000Z",
  rules: [
    { id: "profitTarget", status: "open", value: 4.2, limit: 10, usage: 0.42, unit: "percent" },
    { id: "dailyLoss", status: "danger", value: 3.1, limit: 4, usage: 0.78, unit: "percent", approximate: true },
    { id: "tradingDays", status: "reached", value: 4, limit: 4, usage: 1, unit: "days" },
  ],
  ...overrides,
});

const render = (c: ChallengeEvaluation) =>
  mount(ChallengeRules, { props: { challenge: c }, global: { plugins: [i18n] } });

beforeEach(() => {
  setLocale("en", false);
});

describe("ChallengeRules", () => {
  it("shows values with units, words for limit states and marks estimates", () => {
    const text = render(challenge()).text();
    expect(text).toContain("Challenge · Phase 1 · day 6");
    expect(text).toContain("4.2% of 10.0%");
    expect(text).toContain("≈ 3.1% of 4.0%");
    expect(text).toContain("78 % of the limit used");
    expect(text).toContain("4 of 4");
    expect(text).toContain("Reached");
    // "Running" is the account status already; it is not repeated here.
    expect(text).not.toContain("Running");
  });

  it("shows the overall state when it matters", () => {
    expect(render(challenge({ status: "breached" })).text()).toContain("Breached");
    expect(render(challenge({ status: "passed" })).text()).toContain("Goals reached");
  });

  it("formats percent values per locale", () => {
    expect(formatPercentValue("en", 4.2)).toBe("4.2%");
    expect(formatPercentValue("de", 4.2)).toBe("4,2 %");
    expect(formatPercentValue("de", -1.8)).toBe("−1,8 %");
  });
});
