import { describe, expect, it } from "vitest";
import { pauseWindows, type NewsEvent, type ScheduleRules } from "../src";

const rules = (extra: Partial<ScheduleRules> = {}): ScheduleRules => ({
  timezone: "Europe/Berlin",
  holidays: [],
  ...extra,
});
const weekend = { from: { day: 5, time: "21:00" }, to: { day: 0, time: "23:00" } };
const span = (from: string, to: string) => [new Date(from), new Date(to)] as const;

describe("pauseWindows", () => {
  it("pauses every weekend from Friday evening to Sunday evening, local time, across daylight saving", () => {
    const windows = pauseWindows([rules({ weekend })], [], ...span("2026-10-19T00:00:00Z", "2026-11-02T00:00:00Z"));
    expect(windows.map((w) => [w.start, w.end])).toEqual([
      // Summer time (UTC+2) until 25 October, then UTC+1.
      ["2026-10-23T19:00:00.000Z", "2026-10-25T22:00:00.000Z"],
      ["2026-10-30T20:00:00.000Z", "2026-11-01T22:00:00.000Z"],
    ]);
    expect(windows[0]?.reasons).toEqual(["weekend"]);
  });

  it("keeps a weekend that started before the range and one that wraps the week", () => {
    const sunday = pauseWindows([rules({ weekend })], [], ...span("2026-10-25T12:00:00Z", "2026-10-26T00:00:00Z"));
    expect(sunday.map((w) => w.start)).toEqual(["2026-10-23T19:00:00.000Z"]);
    const sameDay = { from: { day: 1, time: "08:00" }, to: { day: 1, time: "07:00" } };
    const week = pauseWindows(
      [rules({ weekend: sameDay })],
      [],
      ...span("2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z"),
    );
    expect(week.map((w) => [w.start, w.end])).toEqual([
      ["2026-09-28T06:00:00.000Z", "2026-10-05T05:00:00.000Z"],
      ["2026-10-05T06:00:00.000Z", "2026-10-12T05:00:00.000Z"],
    ]);
  });

  it("pauses holidays as whole local days with their names", () => {
    const christmas = { from: "2026-12-24", to: "2026-12-26", name: "Christmas" };
    const windows = pauseWindows(
      [rules({ holidays: [christmas, { from: "2026-12-31" }] })],
      [],
      ...span("2026-12-01T00:00:00Z", "2027-01-05T00:00:00Z"),
    );
    expect(windows).toEqual([
      {
        start: "2026-12-23T23:00:00.000Z",
        end: "2026-12-26T23:00:00.000Z",
        reasons: ["holiday"],
        labels: ["Christmas"],
      },
      { start: "2026-12-30T23:00:00.000Z", end: "2026-12-31T23:00:00.000Z", reasons: ["holiday"], labels: [] },
    ]);
  });

  it("pauses around news of its currencies from the chosen impact on, and merges what touches", () => {
    const events: NewsEvent[] = [
      { time: "2026-10-09T12:30:00Z", currency: "USD", impact: "high", title: "Non-Farm Employment Change" },
      { time: "2026-10-09T12:40:00Z", currency: "USD", impact: "medium", title: "Average Hourly Earnings" },
      { time: "2026-10-09T08:00:00Z", currency: "GBP", impact: "high", title: "GDP" },
    ];
    const news = { currencies: ["USD", "EUR"], impact: "medium" as const, before: 15, after: 10 };
    const windows = pauseWindows([rules({ news })], events, ...span("2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z"));
    expect(windows).toEqual([
      {
        start: "2026-10-09T12:15:00.000Z",
        end: "2026-10-09T12:50:00.000Z",
        reasons: ["news"],
        labels: ["USD Non-Farm Employment Change", "USD Average Hourly Earnings"],
      },
    ]);
    const high = pauseWindows(
      [rules({ news: { ...news, impact: "high" } })],
      events,
      ...span("2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z"),
    );
    expect(high.map((w) => w.labels)).toEqual([["USD Non-Farm Employment Change"]]);
  });

  it("runs a pause on when news touch the weekend", () => {
    const events: NewsEvent[] = [{ time: "2026-10-23T19:05:00Z", currency: "USD", impact: "high", title: "Speech" }];
    const news = { currencies: ["USD"], impact: "high" as const, before: 30, after: 0 };
    const [window] = pauseWindows(
      [rules({ weekend, news })],
      events,
      ...span("2026-10-23T00:00:00Z", "2026-10-24T00:00:00Z"),
    );
    expect(window).toMatchObject({
      start: "2026-10-23T18:35:00.000Z",
      end: "2026-10-25T22:00:00.000Z",
      reasons: ["news", "weekend"],
    });
  });
});

describe("one-off pauses", () => {
  it("pause from a local day and time to another, with their name", () => {
    const periods = [{ from: "2026-10-30T22:00", to: "2026-10-31T06:00", name: "Broker maintenance" }];
    expect(pauseWindows([rules({ periods })], [], ...span("2026-10-30T00:00:00Z", "2026-11-01T00:00:00Z"))).toEqual([
      {
        start: "2026-10-30T21:00:00.000Z",
        end: "2026-10-31T05:00:00.000Z",
        reasons: ["period"],
        labels: ["Broker maintenance"],
      },
    ]);
  });
});

describe("pauseWindows with what is over", () => {
  it("keeps the start of a pause whose first part is over, also across schedules", () => {
    // Weekend until Sunday 23:00 Berlin (22:00 UTC after the time change), news from 21:45 to 22:45 UTC: at 22:30 the
    // weekend is over, but the pause still began on Friday.
    const events: NewsEvent[] = [{ time: "2026-10-25T22:15:00Z", currency: "USD", impact: "high", title: "Speech" }];
    const news = { currencies: ["USD"], impact: "high" as const, before: 30, after: 30 };
    const at = new Date("2026-10-25T22:30:00Z");
    const until = new Date(at.getTime() + 1);
    const together = pauseWindows([rules({ weekend, news })], events, at, until);
    const apart = pauseWindows([rules({ weekend }), rules({ news })], events, at, until);
    for (const [window] of [together, apart]) {
      expect(window).toMatchObject({ start: "2026-10-23T19:00:00.000Z", end: "2026-10-25T22:45:00.000Z" });
    }
  });
});
