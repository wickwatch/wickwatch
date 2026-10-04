// Locale-aware formatting with Intl. Pure functions, so they are easy to test.

const MINUS = "−";
const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) cache.set(key, (format = new Intl.NumberFormat(locale, options)));
  return format;
}

/** Typographic minus (U+2212) instead of a hyphen. */
const withMinus = (text: string) => text.replace(/^-/, MINUS);

export function formatNumber(locale: string, value: number, digits = 2): string {
  return withMinus(
    numberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value),
  );
}

/** Always shows the sign, so profit and loss never depend on colour alone. */
export function formatSigned(locale: string, value: number, digits = 2): string {
  const format = numberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  });
  return withMinus(format.format(value));
}

/** Prices: as many decimals as the value has, up to 5. */
export function formatPrice(locale: string, value: number): string {
  return withMinus(numberFormat(locale, { maximumFractionDigits: 5 }).format(value));
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

/** Local date and time in the browser's time zone; internally everything is UTC. */
/**
 * `datetime` and `day` carry the year (trades and versions can be from last year); `date` is the short day for chart
 * axes, `time` the time of day for log lines.
 */
export function formatDateTime(
  locale: string,
  iso: string,
  /** `clock`: hours and minutes; `weekday`: the short day name. */
  style: "datetime" | "time" | "clock" | "weekday" | "date" | "day" = "datetime",
): string {
  const key = `${locale}|${style}`;
  let format = dateTimeCache.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions =
      style === "time"
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : style === "clock"
          ? { hour: "2-digit", minute: "2-digit" }
          : style === "weekday"
            ? { weekday: "short" }
            : style === "date"
              ? { day: "2-digit", month: "2-digit" }
              : style === "day"
                ? { day: "2-digit", month: "2-digit", year: "numeric" }
                : { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
    dateTimeCache.set(key, (format = new Intl.DateTimeFormat(locale, options)));
  }
  return format.format(new Date(iso));
}

export function formatPercent(locale: string, fraction: number): string {
  return numberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(fraction);
}

/** A value that is already in percent (4.2 → "4.2%" / "4,2 %"), with one decimal. */
export function formatPercentValue(locale: string, percent: number): string {
  const options = { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;
  return withMinus(numberFormat(locale, options).format(percent / 100));
}

/** Up to `digits` decimals, only as many as the value needs ("1.5", "2"). */
export function formatDecimal(locale: string, value: number, digits = 1): string {
  return numberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

export function formatGigabytes(locale: string, bytes: number): string {
  return formatDecimal(locale, bytes / 1024 ** 3);
}

/** A file size in bytes, kilobytes or megabytes, with the unit in the locale's words. */
export function formatFileSize(locale: string, bytes: number): string {
  const [value, unit] =
    bytes < 1024 ? [bytes, "byte"] : bytes < 1024 ** 2 ? [bytes / 1024, "kilobyte"] : [bytes / 1024 ** 2, "megabyte"];
  return numberFormat(locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
}

const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

export function formatRelative(locale: string, iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  let rtf = relativeCache.get(locale);
  if (!rtf) relativeCache.set(locale, (rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })));
  if (Math.abs(seconds) < 60) return rtf.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  return rtf.format(Math.round(seconds / 3600), "hour");
}

export type DurationParts =
  | { key: "format.daysHours"; params: { d: number; h: number } }
  | { key: "format.hoursMinutes"; params: { h: number; m: number } }
  | { key: "format.minutes"; params: { m: number } };

/** Splits an elapsed time for the i18n messages format.daysHours etc. */
export function durationParts(sinceIso: string, now: number): DurationParts {
  const minutes = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return { key: "format.daysHours", params: { d, h } };
  if (h > 0) return { key: "format.hoursMinutes", params: { h, m } };
  return { key: "format.minutes", params: { m } };
}

/**
 * "Name · number" for an account. Without a name of its own (it is saved with the number as name) only the number, not
 * "7012345 · 7012345".
 */
export function accountLabel(account: { displayName?: string | undefined; number: string }): string {
  const name = account.displayName?.trim();
  return name && name !== account.number ? `${name} · ${account.number}` : account.number;
}

const weekdayCache = new Map<string, Intl.DateTimeFormat>();

/** The name of a weekday, 0 for Sunday, e.g. "Friday" / "Freitag". */
export function weekdayName(locale: string, day: number): string {
  let format = weekdayCache.get(locale);
  if (!format)
    weekdayCache.set(locale, (format = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" })));
  // 4 January 1970 was a Sunday.
  return format.format(new Date(Date.UTC(1970, 0, 4 + day)));
}

/** A time with its weekday, e.g. "Fri 23.10.2026, 21:00", for pauses that span days. */
export const formatWhen = (locale: string, iso: string): string =>
  `${formatDateTime(locale, iso, "weekday")} ${formatDateTime(locale, iso)}`;

const BROWSERS: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

/** Browser and system of a user agent for the list of sessions, e.g. "Firefox · macOS"; undefined if neither is known. */
export function deviceName(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const parts = [BROWSERS, SYSTEMS].flatMap((list) => list.find(([pattern]) => pattern.test(userAgent))?.[1] ?? []);
  return parts.length ? parts.join(" · ") : undefined;
}
