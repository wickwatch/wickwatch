import { describe, expect, it } from "vitest";
import { durationParts, formatDateTime, formatNumber, formatPercent, formatSigned } from "../src/format";

describe("format", () => {
  it("shows dates with the year, except the short day on chart axes", () => {
    const iso = "2026-09-30T02:47:00Z";
    expect(formatDateTime("de", iso)).toMatch(/^30\.09\.2026, \d\d:47$/);
    expect(formatDateTime("de", iso, "day")).toBe("30.09.2026");
    expect(formatDateTime("de", iso, "date")).toBe("30.09.");
  });

  it("formats numbers per locale", () => {
    expect(formatNumber("en", 104180.2)).toBe("104,180.20");
    expect(formatNumber("de", 104180.2)).toBe("104.180,20");
  });

  it("always shows the sign and uses a typographic minus", () => {
    expect(formatSigned("de", 320.4)).toBe("+320,40");
    expect(formatSigned("de", -1560.4)).toBe("−1.560,40");
    expect(formatSigned("en", 0)).toBe("0.00");
  });

  it("formats percentages", () => {
    expect(formatPercent("en", 0.38)).toBe("38%");
    expect(formatPercent("de", 0.38)).toBe("38 %");
  });

  it("splits durations into days/hours or hours/minutes", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(durationParts("2026-09-22T08:00:00Z", now)).toEqual({ key: "format.daysHours", params: { d: 3, h: 4 } });
    expect(durationParts("2026-09-25T10:30:00Z", now)).toEqual({ key: "format.hoursMinutes", params: { h: 1, m: 30 } });
    expect(durationParts("2026-09-25T11:55:00Z", now)).toEqual({ key: "format.minutes", params: { m: 5 } });
  });
});
