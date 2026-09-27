// Trading days with a configurable reset time and time zone, e.g. 00:00 Europe/Prague.

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string): Parts {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const get = (type: string) => Number(format.formatToParts(date).find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The UTC instant of a local wall-clock time in a time zone (DST-aware). */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Start of the trading day that contains `time`. */
export function tradingDayStart(time: Date, resetTime = "00:00", timeZone = "UTC"): Date {
  const [hour = 0, minute = 0] = resetTime.split(":").map(Number);
  const p = zonedParts(time, timeZone);
  let start = zonedToUtc(p.year, p.month, p.day, hour, minute, timeZone);
  if (start.getTime() > time.getTime()) {
    const previous = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
    start = zonedToUtc(
      previous.getUTCFullYear(),
      previous.getUTCMonth() + 1,
      previous.getUTCDate(),
      hour,
      minute,
      timeZone,
    );
  }
  return start;
}

/** YYYY-MM-DD: the local date on which the trading day containing `time` started. */
export function tradingDayKey(time: Date, resetTime = "00:00", timeZone = "UTC"): string {
  const p = zonedParts(tradingDayStart(time, resetTime, timeZone), timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); 0 for the same day. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
