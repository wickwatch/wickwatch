import type { Overview } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { Locale } from "../config";
import type { Db } from "../db";
import { summaryText } from "./alert-text";

const REQUEST_TIMEOUT_MS = 10_000;

export interface DailySummaryOptions {
  db: Db;
  load: () => Promise<Overview>;
  webhookUrl: URL;
  /** Local time of day, HH:MM. */
  time: string;
  timeZone: string;
  locale: Locale;
  log: FastifyBaseLogger;
  intervalMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** What ALERT_WEBHOOK_URL receives once a day, see docs/CONFIGURATION.md. */
export interface SummaryEvent {
  event: "daily_summary";
  time: string;
  /** The day it is for, YYYY-MM-DD in DAILY_SUMMARY_TIMEZONE. */
  date: string;
  accounts: {
    number: string;
    name: string;
    currency?: string;
    balance?: number;
    equity?: number;
    dayPnl?: number;
    openPositions: number;
    instances: { total: number; running: number };
    challenge?: { status: string; day: number };
    error?: string;
  }[];
  alerts: number;
  text: string;
  content: string;
}

/** Date and time of day in a time zone, e.g. { day: "2026-09-30", time: "21:30" }. */
export function localClock(now: Date, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/**
 * Posts one summary per day to the alert webhook, at DAILY_SUMMARY_TIME in DAILY_SUMMARY_TIMEZONE (or later that day
 * if the server was down then). Sent days are stored, so a restart does not repeat one; a failed post is retried
 * every minute until the day ends.
 */
export class DailySummary {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: DailySummaryOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** True when a summary was sent in this check. */
  async check(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const { db, time, timeZone } = this.options;
      const now = this.now();
      const clock = localClock(now, timeZone);
      if (clock.time < time) return false;
      const sent = await db.selectFrom("daily_summaries").select("day").where("day", "=", clock.day).executeTakeFirst();
      if (sent) return false;
      const overview = await this.options.load();
      if (!(await this.post(this.event(overview, clock.day, now)))) return false;
      await db.insertInto("daily_summaries").values({ day: clock.day, sent_at: now.toISOString() }).execute();
      return true;
    } catch (error) {
      this.options.log.warn({ err: error }, "Daily summary failed");
      return false;
    } finally {
      this.running = false;
    }
  }

  private event(overview: Overview, date: string, now: Date): SummaryEvent {
    const text = summaryText(overview, this.options.locale, date);
    return {
      event: "daily_summary",
      time: now.toISOString(),
      date,
      accounts: overview.accounts.map((a) => ({
        number: a.number,
        name: a.displayName,
        ...(a.currency ? { currency: a.currency } : {}),
        ...(a.balance !== undefined ? { balance: a.balance } : {}),
        ...(a.equity !== undefined ? { equity: a.equity } : {}),
        ...(a.dayPnl !== undefined ? { dayPnl: a.dayPnl } : {}),
        openPositions: a.openPositions,
        instances: a.instances,
        ...(a.challenge ? { challenge: { status: a.challenge.status, day: a.challenge.day } } : {}),
        ...(a.error ? { error: a.error } : {}),
      })),
      alerts: overview.alerts.length,
      text,
      content: text,
    };
  }

  private async post(body: SummaryEvent): Promise<boolean> {
    try {
      const response = await this.fetch(this.options.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return true;
      this.options.log.warn({ status: response.status }, "Alert webhook refused the daily summary");
    } catch (error) {
      this.options.log.warn({ reason: (error as Error).name }, "Alert webhook not reachable for the daily summary");
    }
    return false;
  }
}
