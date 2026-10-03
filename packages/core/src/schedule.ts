import type { NewsEvent, NewsImpact, PauseReason, PauseWindow, ScheduleRules } from "./schemas";
import { tradingDayStartOf, zonedDay, zonedToUtc } from "./trading-day";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const RANK: Record<NewsImpact, number> = { medium: 0, high: 1 };

interface Span {
  start: number;
  end: number;
  reason: PauseReason;
  label?: string;
}

/** A local calendar day `offset` days after another; plain calendar arithmetic, the same in every zone. */
function addDays(day: { year: number; month: number; day: number }, offset: number) {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + offset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function parseDay(day: string) {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return { year, month, day: date };
}

function at(day: { year: number; month: number; day: number }, time: string, timeZone: string): number {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zonedToUtc(day.year, day.month, day.day, hour, minute, timeZone).getTime();
}

/** The pauses one schedule makes: its weekends (from a week before `from`), holidays and news, unmerged. */
function spansOf(rules: ScheduleRules, events: NewsEvent[], from: Date, to: Date): Span[] {
  const { timezone, weekend, holidays, news } = rules;
  const spans: Span[] = [];

  if (weekend) {
    let length = (weekend.to.day - weekend.from.day + 7) % 7;
    if (length === 0 && weekend.to.time <= weekend.from.time) length = 7;
    // From the weekend start day on or before a week ahead of `from`: a weekend begun then may still run.
    const before = zonedDay(new Date(from.getTime() - 7 * DAY_MS), timezone);
    let day = addDays(before, -((before.weekday - weekend.from.day + 7) % 7));
    for (; at(day, "00:00", timezone) < to.getTime(); day = addDays(day, 7)) {
      spans.push({
        start: at(day, weekend.from.time, timezone),
        end: at(addDays(day, length), weekend.to.time, timezone),
        reason: "weekend",
      });
    }
  }

  for (const holiday of holidays) {
    spans.push({
      start: tradingDayStartOf(holiday.from, "00:00", timezone).getTime(),
      end: at(addDays(parseDay(holiday.to ?? holiday.from), 1), "00:00", timezone),
      reason: "holiday",
      ...(holiday.name ? { label: holiday.name } : {}),
    });
  }

  for (const period of rules.periods ?? []) {
    const [fromDay = "", fromTime = "00:00"] = period.from.split("T");
    const [toDay = "", toTime = "00:00"] = period.to.split("T");
    spans.push({
      start: at(parseDay(fromDay), fromTime, timezone),
      end: at(parseDay(toDay), toTime, timezone),
      reason: "period",
      ...(period.name ? { label: period.name } : {}),
    });
  }

  if (news) {
    const currencies = new Set(news.currencies);
    for (const event of events) {
      if (!currencies.has(event.currency) || RANK[event.impact] < RANK[news.impact]) continue;
      const time = Date.parse(event.time);
      spans.push({
        start: time - news.before * MINUTE_MS,
        end: time + news.after * MINUTE_MS,
        reason: "news",
        label: `${event.currency} ${event.title}`,
      });
    }
  }
  return spans;
}

/**
 * When schedules pause their instances between `from` and `to`: their weekends every week, their holidays as whole
 * local days and the news of their currencies from `before` to `after` minutes around them. Pauses that overlap or
 * touch are merged first, also across schedules, so a pause runs on without a start in between and keeps the start of
 * its first part even when that part is over. Pure: the news come from the caller.
 */
export function pauseWindows(schedules: ScheduleRules[], events: NewsEvent[], from: Date, to: Date): PauseWindow[] {
  const spans = schedules.flatMap((rules) => spansOf(rules, events, from, to));
  const windows: { start: number; end: number; reasons: Set<PauseReason>; labels: string[] }[] = [];
  for (const span of spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)) {
    const last = windows.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      last.reasons.add(span.reason);
      if (span.label && !last.labels.includes(span.label)) last.labels.push(span.label);
    } else {
      windows.push({
        start: span.start,
        end: span.end,
        reasons: new Set([span.reason]),
        labels: span.label ? [span.label] : [],
      });
    }
  }
  return windows
    .filter((w) => w.end > from.getTime() && w.start < to.getTime())
    .map((w) => ({
      start: new Date(w.start).toISOString(),
      end: new Date(w.end).toISOString(),
      reasons: [...w.reasons],
      labels: w.labels,
    }));
}
