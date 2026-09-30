import type { FastifyBaseLogger } from "fastify";

const HOUR_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** A reading older than this no longer says anything about the clock. */
const STALE_MS = 3 * HOUR_MS;
/** Answers slower than this are too uncertain to judge a clock by. */
const MAX_ROUND_TRIP_MS = 3000;

export interface ClockReading {
  /** Server clock minus the reference, in ms: positive when the server runs ahead. */
  offsetMs: number;
  checkedAt: number;
}

let latest: ClockReading | undefined;
/** Set once a check runs; before that (or with CLOCK_CHECK_URL=off) the clock is not checked at all. */
let running = false;

/** "unavailable" when a check runs but had no usable answer lately; undefined when none runs or all is well. */
export function clockCheckState(now = Date.now()): "unavailable" | undefined {
  return running && clockOffset(now) === undefined ? "unavailable" : undefined;
}

/** The last measured offset, if recent; undefined when the check is off or has not succeeded lately. */
export function clockOffset(now = Date.now()): number | undefined {
  return latest && now - latest.checkedAt <= STALE_MS ? latest.offsetMs : undefined;
}

/**
 * The reference time in the answer: `ts=<unix seconds>` as in Cloudflare's /cdn-cgi/trace, else the Date header.
 * Whole seconds (no fraction, or `.000` as Cloudflare sends it at times) stand for the middle of that second.
 * Undefined when neither is there.
 */
export function referenceTime(body: string, dateHeader: string | null): { ms: number; precise: boolean } | undefined {
  const ts = /^ts=(\d+)(?:\.(\d+))?$/m.exec(body);
  if (ts) {
    const seconds = Number(ts[1]) * 1000;
    const fraction = ts[2] ? Number(`0.${ts[2]}`) * 1000 : 0;
    return fraction > 0 ? { ms: Math.round(seconds + fraction), precise: true } : { ms: seconds + 500, precise: false };
  }
  const date = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  return Number.isNaN(date) ? undefined : { ms: date + 500, precise: false };
}

/**
 * Measures how far the server clock is off, hourly, against CLOCK_CHECK_URL. For runtimes that cannot tell whether
 * the host syncs its clock (Docker: the container does not see NTP). Bots, trading days and daily loss resets all
 * depend on the time, so a clock that drifts is worth an alert.
 */
export class ClockCheck {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      url: URL;
      log: FastifyBaseLogger;
      intervalMs?: number;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    running = true;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? HOUR_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    running = false;
  }

  async check(): Promise<ClockReading | undefined> {
    const { url, log } = this.options;
    try {
      const sent = this.now();
      const res = await this.fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const body = await res.text();
      const received = this.now();
      const reference = referenceTime(body, res.headers.get("date"));
      if (!res.ok || !reference || received - sent > MAX_ROUND_TRIP_MS) {
        log.warn({ status: res.status, roundTripMs: received - sent }, "Clock check: no usable time in the answer");
        return undefined;
      }
      const reading = { offsetMs: Math.round((sent + received) / 2 - reference.ms), checkedAt: received };
      latest = reading;
      log.info({ offsetMs: reading.offsetMs, precise: reference.precise }, "Clock check");
      return reading;
    } catch (error) {
      log.warn({ err: error }, "Clock check failed");
      return undefined;
    }
  }
}

/** For tests: forget the last reading. */
export function resetClockReading(): void {
  latest = undefined;
  running = false;
}
