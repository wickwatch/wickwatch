import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockCheck, clockOffset, referenceTime, resetClockReading } from "../src/services/clock-check";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
afterEach(() => {
  resetClockReading();
});

const answer = (body: string, date?: string) =>
  (async () => new Response(body, { headers: date ? { date } : {} })) as unknown as typeof fetch;

describe("clock check", () => {
  it("reads Cloudflare's ts= line in milliseconds, else the Date header", () => {
    expect(referenceTime("fl=1\nts=1727712000.250\nvisit_scheme=https", null)).toEqual({
      ms: 1727712000250,
      precise: true,
    });
    // Whole seconds stand for the middle of the second.
    expect(referenceTime("ts=1727712000.000", null)).toEqual({ ms: 1727712000500, precise: false });
    expect(referenceTime("<html>", "Mon, 30 Sep 2024 16:00:00 GMT")).toEqual({
      ms: Date.parse("2024-09-30T16:00:00Z") + 500,
      precise: false,
    });
    expect(referenceTime("<html>", null)).toBeUndefined();
  });

  it("measures the offset against the middle of the round trip", async () => {
    // Sent at 10.000 s, answered at 10.200 s; the reference said 7.000 s (so 7.5 s): the server runs 2.6 s ahead.
    const times = [10_000, 10_200];
    const check = new ClockCheck({
      url: new URL("https://time.example/trace"),
      log,
      fetch: answer("ts=7.000"),
      now: () => times.shift() ?? 10_200,
    });
    expect(await check.check()).toEqual({ offsetMs: 2600, checkedAt: 10_200 });
    expect(clockOffset(10_200)).toBe(2600);
    // Hours later, the reading is too old to say anything.
    expect(clockOffset(10_200 + 4 * 60 * 60 * 1000)).toBeUndefined();
  });

  it("ignores answers without a time or with a slow round trip", async () => {
    const noTime = new ClockCheck({ url: new URL("https://time.example/"), log, fetch: answer("nothing") });
    expect(await noTime.check()).toBeUndefined();
    const times = [0, 5000];
    const slow = new ClockCheck({
      url: new URL("https://time.example/"),
      log,
      fetch: answer("ts=0"),
      now: () => times.shift() ?? 5000,
    });
    expect(await slow.check()).toBeUndefined();
    expect(clockOffset()).toBeUndefined();
  });
});
