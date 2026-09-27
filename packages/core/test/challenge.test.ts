import { describe, expect, it } from "vitest";
import { evaluateChallenge, tradingDayKey, tradingDayStart, type ChallengeInput, type ChallengeProfile } from "../src";

describe("trading day", () => {
  it("starts at the reset time in the given zone, also across DST", () => {
    // Prague is UTC+2 in summer: midnight there is 22:00 UTC the day before.
    expect(tradingDayStart(new Date("2026-07-10T21:59:00Z"), "00:00", "Europe/Prague").toISOString()).toBe(
      "2026-07-09T22:00:00.000Z",
    );
    expect(tradingDayStart(new Date("2026-07-10T22:01:00Z"), "00:00", "Europe/Prague").toISOString()).toBe(
      "2026-07-10T22:00:00.000Z",
    );
    // In winter it is UTC+1.
    expect(tradingDayStart(new Date("2026-01-10T12:00:00Z"), "00:00", "Europe/Prague").toISOString()).toBe(
      "2026-01-09T23:00:00.000Z",
    );
    // 17:00 New York: before the reset the day started the previous evening.
    expect(tradingDayStart(new Date("2026-09-25T20:00:00Z"), "17:00", "America/New_York").toISOString()).toBe(
      "2026-09-24T21:00:00.000Z",
    );
    expect(tradingDayKey(new Date("2026-07-10T22:01:00Z"), "00:00", "Europe/Prague")).toBe("2026-07-11");
  });
});

const profile: ChallengeProfile = {
  name: "Prop A – Phase 1",
  phase: "Phase 1",
  startDate: "2026-09-20",
  startBalance: 100_000,
  rules: {
    profitTargetPct: 10,
    dailyLoss: {
      limitPct: 5,
      reference: "balance-or-equity-at-day-start",
      resetTime: "00:00",
      timezone: "Europe/Prague",
    },
    maxLoss: { limitPct: 10, type: "static" },
    minTradingDays: 4,
    durationDays: 30,
  },
};

const input = (overrides: Partial<ChallengeInput> = {}): ChallengeInput => ({
  now: new Date("2026-09-25T10:00:00Z"),
  profile,
  balance: 104_180.2,
  equity: 104_390.6,
  realizedToday: 0,
  today: { startEquity: 104_180.2, minEquity: 104_100, firstSampleAt: "2026-09-24T22:01:00Z" },
  tradingDays: 3,
  ...overrides,
});

const rule = (result: ReturnType<typeof evaluateChallenge>, id: string) => result.rules.find((r) => r.id === id);

describe("evaluateChallenge", () => {
  it("reports progress, limits and the challenge day", () => {
    const result = evaluateChallenge(input());
    expect(result).toMatchObject({ name: "Prop A – Phase 1", phase: "Phase 1", day: 6, status: "running" });
    expect(rule(result, "profitTarget")).toMatchObject({ status: "open", value: 4.18, limit: 10 });
    expect(rule(result, "dailyLoss")).toMatchObject({ status: "ok", value: 0.08, limit: 5 });
    expect(rule(result, "dailyLoss")).not.toHaveProperty("approximate");
    expect(rule(result, "maxLoss")).toMatchObject({ status: "ok", value: 0 });
    expect(rule(result, "tradingDays")).toMatchObject({ status: "open", value: 3, limit: 4 });
    expect(rule(result, "duration")).toMatchObject({ status: "ok", value: 6, limit: 30 });
    expect(result.tradingDayStart).toBe("2026-09-24T22:00:00.000Z");
  });

  it("warns at 50 %, is dangerous at 80 % and breached at 100 % of the daily limit", () => {
    const at = (equity: number) =>
      rule(evaluateChallenge(input({ equity, today: { ...input().today, minEquity: equity } })), "dailyLoss");
    expect(at(101_700)?.status).toBe("ok");
    expect(at(101_600)?.status).toBe("warning");
    expect(at(100_100)?.status).toBe("danger");
    const breached = evaluateChallenge(input({ equity: 99_000, today: { ...input().today, minEquity: 99_000 } }));
    expect(rule(breached, "dailyLoss")?.status).toBe("breached");
    expect(breached.status).toBe("breached");
  });

  it("uses the lowest equity of the day, not only the current one", () => {
    const result = evaluateChallenge(input({ today: { ...input().today, minEquity: 100_180.2 } }));
    expect(rule(result, "dailyLoss")).toMatchObject({ value: 4, status: "danger" });
  });

  it("derives the day-start balance from today's deals and flags missing day-start equity", () => {
    // Balance fell by 2,000 through trades today; the day started at 106,180.20.
    const result = evaluateChallenge(
      input({ balance: 104_180.2, equity: 104_180.2, realizedToday: -2_000, today: {} }),
    );
    expect(rule(result, "dailyLoss")).toMatchObject({ value: 2, approximate: true });
    // Recorded too late after the reset: still approximate.
    const late = evaluateChallenge(input({ today: { startEquity: 104_180.2, firstSampleAt: "2026-09-25T06:00:00Z" } }));
    expect(rule(late, "dailyLoss")?.approximate).toBe(true);
  });

  it("measures trailing max loss from the highest recorded equity", () => {
    const trailing: ChallengeProfile = {
      ...profile,
      rules: { ...profile.rules, maxLoss: { limitPct: 10, type: "trailing" } },
    };
    const result = evaluateChallenge(input({ profile: trailing, peakEquity: 110_000, equity: 104_500, today: {} }));
    expect(rule(result, "maxLoss")).toMatchObject({ value: 5, status: "warning" });
  });

  it("passes when target and trading days are reached and nothing is breached", () => {
    const result = evaluateChallenge(input({ balance: 110_500, equity: 110_500, tradingDays: 4, today: {} }));
    expect(result.status).toBe("passed");
  });

  it("breaks the duration rule after the last day", () => {
    const result = evaluateChallenge(input({ now: new Date("2026-10-21T10:00:00Z") }));
    expect(rule(result, "duration")).toMatchObject({ status: "breached", value: 32 });
  });

  it("evaluates only the rules a profile has", () => {
    const minimal: ChallengeProfile = {
      name: "Own",
      startDate: "2026-09-25",
      startBalance: 10_000,
      rules: { maxLoss: { limitPct: 6, type: "static" } },
    };
    const result = evaluateChallenge(input({ profile: minimal, balance: 9_900, equity: 9_880, today: {} }));
    expect(result.rules.map((r) => r.id)).toEqual(["maxLoss"]);
    expect(result).toMatchObject({ day: 1, status: "running" });
  });
});
