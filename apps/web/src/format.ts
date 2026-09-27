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
export function formatDateTime(locale: string, iso: string, style: "datetime" | "time" | "date" = "datetime"): string {
  const key = `${locale}|${style}`;
  let format = dateTimeCache.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions =
      style === "time"
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : style === "date"
          ? { day: "2-digit", month: "2-digit" }
          : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
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

export function formatGigabytes(locale: string, bytes: number): string {
  return numberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3);
}

export function formatRelative(locale: string, iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
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
