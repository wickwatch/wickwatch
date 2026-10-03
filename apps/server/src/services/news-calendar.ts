import { NewsImpact, type NewsEvent } from "@wickwatch/core";
import Value from "typebox/value";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";
import { REQUEST_TIMEOUT_MS } from "./webhook";

const MINUTE_MS = 60 * 1000;
/** The calendar changes little within a week; hourly keeps new and moved events close enough. */
const REFRESH_MS = 60 * MINUTE_MS;
/** After a failed fetch the next try waits this long. */
const RETRY_MS = 15 * MINUTE_MS;
/** Events this old are dropped. */
const KEEP_MS = 14 * 24 * 60 * MINUTE_MS;

/**
 * The events of a calendar feed in the Forex Factory format: `[{ title, country, date, impact }]`, `country` a
 * currency, `date` with offset, `impact` High or Medium. Other entries (low impact, holidays, bad dates) are left out:
 * no schedule pauses for them.
 */
export function parseCalendar(data: unknown): NewsEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry: unknown): NewsEvent[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { title, country, date, impact } = entry as Record<string, unknown>;
    const level = typeof impact === "string" ? impact.toLowerCase() : undefined;
    const time = typeof date === "string" ? Date.parse(date) : NaN;
    if (typeof title !== "string" || typeof country !== "string" || !/^[A-Z]{3}$/.test(country)) return [];
    if (!Value.Check(NewsImpact, level) || Number.isNaN(time)) return [];
    return [{ time: new Date(time).toISOString(), currency: country, impact: level, title: title.slice(0, 200) }];
  });
}

/**
 * The economic calendar for news pauses, fetched from NEWS_CALENDAR_URL only while a schedule has news rules (the
 * scheduler asks), hourly, and stored so a restart has it at once.
 */
export class NewsCalendar {
  private due = 0;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      db: Db;
      log: FastifyBaseLogger;
      /** Undefined with NEWS_CALENDAR_URL=off: news pauses then have no events. */
      url: URL | undefined;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Fetches the calendar if the last fetch is an hour old; a failure keeps the stored events and is logged. */
  async refresh(): Promise<void> {
    const { db, log, url } = this.options;
    const now = this.now();
    if (!url || now < this.due) return;
    this.due = now + REFRESH_MS;
    try {
      const res = await this.fetch(url, {
        headers: { accept: "application/json", "user-agent": "wickwatch" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      const events = parseCalendar(await res.json());
      if (!events.length) return;
      const times = events.map((e) => e.time).sort();
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom("news_events")
          .where((eb) =>
            eb.or([
              eb.between("time", times[0] ?? "", times.at(-1) ?? ""),
              eb("time", "<", new Date(now - KEEP_MS).toISOString()),
            ]),
          )
          .execute();
        await trx.insertInto("news_events").values(events).execute();
      });
    } catch (error) {
      this.due = now + RETRY_MS;
      // The URL is not logged: it may hold a token.
      log.warn({ err: error }, "Fetching the news calendar failed");
    }
  }

  async events(from: Date, to: Date): Promise<NewsEvent[]> {
    const rows = await this.options.db
      .selectFrom("news_events")
      .select(["time", "currency", "impact", "title"])
      .where("time", ">=", from.toISOString())
      .where("time", "<", to.toISOString())
      .orderBy("time")
      .execute();
    // Only parsed events are stored.
    return rows as NewsEvent[];
  }
}
