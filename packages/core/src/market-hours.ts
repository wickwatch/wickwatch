// When a symbol can be traded, from the broker's weekly sessions. Dependency-free, so the SPA can import it at runtime
// (`@wickwatch/core/market-hours`) and keep the state current between polls.

import type { MarketHours } from "./schemas/broker";
import { zoneOffsetSeconds } from "./trading-day";

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** How long before a session ends the market counts as closing soon. */
export const CLOSING_SOON_MS = 30 * 60 * 1000;

/** Sunday 00:00 UTC of the week `now` is in, in ms; sessions count their seconds from there. */
export const weekStart = (now: Date): number =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay());

export interface MarketState {
  open: boolean;
  /** When it closes (if open) or opens (if closed); missing when always open or without sessions. */
  next?: Date;
}

/** Open or closed at `now` by the weekly sessions; holidays are not in them. */
export function marketState(hours: MarketHours, now: Date): MarketState {
  if (hours.alwaysOpen) return { open: true };
  const start = weekStart(now);
  // This week's sessions and their neighbours (a session over the week's end, next week's first), with sessions that
  // follow each other without a break joined: the market only closes at the end of the last one.
  const sessions = [-1, 0, 1]
    .flatMap((week) =>
      hours.sessions.map((s) => ({
        from: start + (s.start + week * WEEK_SECONDS) * 1000,
        to: start + (s.end + week * WEEK_SECONDS) * 1000,
      })),
    )
    .sort((a, b) => a.from - b.from);
  const windows: { from: number; to: number }[] = [];
  for (const { from, to } of sessions) {
    const last = windows.at(-1);
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else windows.push({ from, to });
  }
  const at = now.getTime();
  const current = windows.find((w) => w.from <= at && at < w.to);
  if (current) return { open: true, next: new Date(current.to) };
  const upcoming = windows.find((w) => w.from > at);
  return upcoming ? { open: false, next: new Date(upcoming.from) } : { open: false };
}

/**
 * Sessions given in seconds from Sunday 00:00 in a time zone, as seconds from Sunday 00:00 UTC. The zone's offset at
 * `now` is used, so a schedule fetched again after a change to or from summer time is converted with the new offset.
 */
export function sessionsToUtc(
  sessions: { start: number; end: number }[],
  timeZone: string,
  now: Date,
): MarketHours["sessions"] {
  const offset = zoneOffsetSeconds(timeZone, now);
  return sessions
    .map((s) => {
      const start = (((s.start - offset) % WEEK_SECONDS) + WEEK_SECONDS) % WEEK_SECONDS;
      return { start, end: start + (s.end - s.start) };
    })
    .sort((a, b) => a.start - b.start);
}
