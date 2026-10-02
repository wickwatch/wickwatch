import { describe, expect, it } from "vitest";
import { marketState, sessionsToUtc, weekStart, type MarketHours } from "../src";

const HOUR = 3600;
const DAY = 24 * HOUR;
// Mon–Fri 22:05–20:50 UTC of the next day, as US30.cash at FTMO in summer (Mon 01:05–23:50 Moscow time).
const us30: MarketHours = {
  alwaysOpen: false,
  sessions: [0, 1, 2, 3, 4].map((d) => ({
    start: d * DAY + 22 * HOUR + 5 * 60,
    end: (d + 1) * DAY + 20 * HOUR + 50 * 60,
  })),
};
const at = (iso: string) => new Date(iso);

describe("weekStart", () => {
  it("is Sunday 00:00 UTC", () => {
    expect(weekStart(at("2026-10-02T19:27:00Z"))).toBe(Date.parse("2026-09-27T00:00:00Z"));
    expect(weekStart(at("2026-09-27T00:00:00Z"))).toBe(Date.parse("2026-09-27T00:00:00Z"));
    // Across a month's start.
    expect(weekStart(at("2026-10-01T10:00:00Z"))).toBe(Date.parse("2026-09-27T00:00:00Z"));
  });
});

describe("marketState", () => {
  it("is open in a session, with the time it closes", () => {
    expect(marketState(us30, at("2026-10-02T19:27:00Z"))).toEqual({ open: true, next: at("2026-10-02T20:50:00Z") });
  });

  it("is closed in the daily break and over the weekend, with the time it opens", () => {
    expect(marketState(us30, at("2026-09-30T21:00:00Z"))).toEqual({ open: false, next: at("2026-09-30T22:05:00Z") });
    // Friday evening: the next session starts on Sunday, in the following week.
    expect(marketState(us30, at("2026-10-02T21:00:00Z"))).toEqual({ open: false, next: at("2026-10-04T22:05:00Z") });
  });

  it("finds a session reaching into the next week", () => {
    const sundayNight: MarketHours = {
      alwaysOpen: false,
      sessions: [{ start: 6 * DAY + 23 * HOUR, end: 7 * DAY + HOUR }],
    };
    // Sunday 00:30 UTC belongs to the session that began Saturday 23:00.
    expect(marketState(sundayNight, at("2026-10-04T00:30:00Z"))).toEqual({
      open: true,
      next: at("2026-10-04T01:00:00Z"),
    });
  });

  it("closes only at the end of back-to-back sessions", () => {
    const joined: MarketHours = {
      alwaysOpen: false,
      sessions: [
        { start: DAY, end: 2 * DAY },
        { start: 2 * DAY, end: 3 * DAY },
      ],
    };
    expect(marketState(joined, at("2026-09-28T12:00:00Z")).next).toEqual(at("2026-09-30T00:00:00Z"));
  });

  it("is always open without a time when the broker says so", () => {
    expect(marketState({ alwaysOpen: true, sessions: [] }, at("2026-10-03T12:00:00Z"))).toEqual({ open: true });
  });
});

describe("sessionsToUtc", () => {
  it("converts from the broker's time zone with its offset at the time", () => {
    // Mon 01:05–23:50 in Moscow (UTC+3) is Sun 22:05 – Mon 20:50 UTC.
    expect(sessionsToUtc([{ start: 90_300, end: 172_200 }], "Europe/Moscow", at("2026-10-02T19:27:00Z"))).toEqual([
      { start: 79_500, end: 161_400 },
    ]);
    // Berlin is UTC+2 in summer and UTC+1 in winter.
    const monday9 = [{ start: DAY + 9 * HOUR, end: DAY + 17 * HOUR }];
    expect(sessionsToUtc(monday9, "Europe/Berlin", at("2026-07-01T00:00:00Z"))[0]?.start).toBe(DAY + 7 * HOUR);
    expect(sessionsToUtc(monday9, "Europe/Berlin", at("2026-12-01T00:00:00Z"))[0]?.start).toBe(DAY + 8 * HOUR);
  });

  it("wraps a session that starts before Sunday 00:00 UTC to the end of the week", () => {
    // Sun 00:30–02:00 in Moscow starts Saturday 21:30 UTC.
    expect(sessionsToUtc([{ start: 1800, end: 7200 }], "Europe/Moscow", at("2026-10-02T00:00:00Z"))).toEqual([
      { start: 6 * DAY + 21.5 * HOUR, end: 6 * DAY + 23 * HOUR },
    ]);
  });
});
