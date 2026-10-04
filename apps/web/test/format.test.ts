import { describe, expect, it } from "vitest";
import {
  accountLabel,
  deviceName,
  durationParts,
  formatDateTime,
  formatDecimal,
  formatFileSize,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSigned,
} from "../src/format";

describe("format", () => {
  it("names an account once: only the number when it has no name of its own", () => {
    expect(accountLabel({ displayName: "Prop A", number: "1111111" })).toBe("Prop A · 1111111");
    expect(accountLabel({ displayName: "7012345", number: "7012345" })).toBe("7012345");
    expect(accountLabel({ displayName: " ", number: "7012345" })).toBe("7012345");
    expect(accountLabel({ number: "7012345" })).toBe("7012345");
  });

  it("shows dates with the year, except the short day on chart axes", () => {
    const iso = "2026-09-30T02:47:00Z";
    expect(formatDateTime("de", iso)).toMatch(/^30\.09\.2026, \d\d:47$/);
    expect(formatDateTime("de", iso, "day")).toBe("30.09.2026");
    expect(formatDateTime("de", iso, "date")).toBe("30.09.");
  });

  it("formats decimals, file sizes and relative times per locale", () => {
    expect(formatDecimal("de", 1.25)).toBe("1,3");
    expect(formatDecimal("en", 2)).toBe("2");
    expect(formatFileSize("en", 512)).toBe("512 byte");
    expect(formatFileSize("de", 1536)).toBe("1,5 kB");
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(formatRelative("en", "2026-09-30T11:58:00Z", now)).toBe("2 minutes ago");
    expect(formatRelative("de", "2026-09-30T11:58:00Z", now)).toBe("vor 2 Minuten");
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

  it("names the device of a session by browser and system", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const edge =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
    const android =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    expect([mac, iphone, edge, android].map(deviceName)).toEqual([
      "Firefox · macOS",
      "Safari · iOS",
      "Edge · Windows",
      "Chrome · Android",
    ]);
    expect(deviceName("curl/8.7.1")).toBeUndefined();
    expect(deviceName(undefined)).toBeUndefined();
  });
});
