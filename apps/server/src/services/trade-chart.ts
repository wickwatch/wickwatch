import type { BrokerAdapter, Candle } from "@wickwatch/core";
import type { AccountEntry } from "../accounts";

/** More bars than this make a longer period: the chart stays readable and one broker call answers it. */
export const MAX_BARS = 500;
/** Bars shown before the opening, at least: the setup the trade came from. */
const MIN_BARS_BEFORE = 30;
/** Bars shown after the close, at least: what the price did next. */
const MIN_BARS_AFTER = 10;
/** Answers kept; a chart is opened by hand, so few are asked for. */
const CACHE_SIZE = 50;
/** Candles of a window that ended long ago do not change; kept this long. */
const CLOSED_TTL_MS = 6 * 60 * 60 * 1000;
/** A window reaching the bar still open is asked again after this long: its last bar moves on. */
const LIVE_TTL_MS = 30_000;
/** The bar still open is built from at most this many bars of a shorter period; it lags behind by one of them. */
const MAX_PARTS = 300;

/** A period based on time and the length of its bars, in milliseconds. */
export interface TimedPeriod {
  period: string;
  ms: number;
}

/** What a chart needs of the broker adapter, bound to it. */
export interface ChartBroker {
  candles: NonNullable<BrokerAdapter["candles"]>;
  periods: string[];
  /** The periods based on time, shortest first; never empty. */
  timed: TimedPeriod[];
}

/** Undefined when the adapter has no candles or no period based on time: no chart is offered then. */
export function chartBroker(broker: BrokerAdapter): ChartBroker | undefined {
  if (!broker.candles || !broker.periods || !broker.periodSeconds) return undefined;
  const periods = broker.periods();
  const timed = timedPeriods(periods, broker.periodSeconds.bind(broker));
  return timed.length ? { candles: broker.candles.bind(broker), periods, timed } : undefined;
}

export function timedPeriods(
  periods: readonly string[],
  periodSeconds: (period: string) => number | undefined,
): TimedPeriod[] {
  return periods
    .flatMap((period) => {
      const seconds = periodSeconds(period);
      return seconds ? [{ period, ms: seconds * 1000 }] : [];
    })
    .sort((a, b) => a.ms - b.ms);
}

export interface ChartWindow {
  period: string;
  /** Length of a bar of the period. */
  ms: number;
  /** Epoch milliseconds, on bar boundaries of the period counted from the epoch. */
  from: number;
  to: number;
}

/**
 * The period and time range of the chart of a trade opened at `opened` and closed at `closed` (open while missing):
 * bars before the opening for its setup and, once closed, some after. The period asked for when the trade fits it in
 * MAX_BARS, else the next longer one that it fits; without one (or one not based on time) the shortest one that fits.
 * `timed` is not empty (chartBroker).
 */
export function chartWindow(
  trade: { opened: number; closed?: number | undefined; now: number },
  wanted: string | undefined,
  timed: readonly TimedPeriod[],
): ChartWindow {
  const end = Math.min(trade.closed ?? trade.now, trade.now);
  const span = Math.max(0, end - trade.opened);
  const bars = (ms: number) => {
    const held = Math.max(1, Math.ceil(span / ms));
    const before = Math.max(MIN_BARS_BEFORE, Math.ceil(held * 0.3));
    const after = trade.closed === undefined ? 0 : Math.max(MIN_BARS_AFTER, Math.ceil(held * 0.15));
    return { before, after, total: before + held + after };
  };
  const wantedMs = timed.find((p) => p.period === wanted)?.ms;
  const candidates = wantedMs ? timed.filter((p) => p.ms >= wantedMs) : timed;
  const chosen = candidates.find((p) => bars(p.ms).total <= MAX_BARS) ?? candidates.at(-1);
  // Not reached: the wanted period is among the candidates, and chartBroker offers no chart without timed ones.
  if (!chosen) throw new Error("No period based on time");
  const { before, after } = bars(chosen.ms);
  const floor = (time: number) => Math.floor(time / chosen.ms) * chosen.ms;
  return {
    // The one asked for under its own name, even when another period has the same length.
    period: wanted !== undefined && wantedMs === chosen.ms ? wanted : chosen.period,
    ms: chosen.ms,
    from: floor(trade.opened) - before * chosen.ms,
    to: floor(Math.min(end + after * chosen.ms, trade.now)),
  };
}

/** The shortest period based on time that is shorter than `ms` and makes at most MAX_PARTS of its bars. */
export function partPeriod(timed: readonly TimedPeriod[], ms: number): TimedPeriod | undefined {
  return timed.find((p) => p.ms < ms && ms / p.ms <= MAX_PARTS);
}

/**
 * The bar still open, from the bars of a shorter period since the last closed one (`last`, its opening in ms): the
 * bar the newest part falls in, counted from `last` in steps of `ms` (bars of a day may open at the broker's session
 * boundary, not at midnight). Undefined without parts after the last closed bar.
 */
export function openBar(parts: readonly Candle[], last: number, ms: number): Candle | undefined {
  const newest = parts.at(-1);
  if (!newest) return undefined;
  const start = last + Math.floor((Date.parse(newest.time) - last) / ms) * ms;
  if (start <= last) return undefined;
  const inBar = parts.filter((p) => Date.parse(p.time) >= start);
  return {
    time: new Date(start).toISOString(),
    open: inBar[0]?.open ?? newest.open,
    high: Math.max(...inBar.map((p) => p.high)),
    low: Math.min(...inBar.map((p) => p.low)),
    close: newest.close,
  };
}

export interface CandleCache {
  /**
   * Candles of the account's symbol in the window; the same window is asked of the broker once while kept. Brokers
   * give closed bars only: a window reaching the bar still open gets it built from a shorter period.
   */
  get(account: AccountEntry, symbol: string, window: ChartWindow): Promise<Candle[]>;
}

/**
 * Keeps the latest answers: stepping through trades in the details goes back and forth. A window reaching the bar
 * still open is kept only briefly, so an open position's chart follows the price.
 */
export function createCandleCache(broker: Pick<ChartBroker, "candles" | "timed">, now = () => Date.now()): CandleCache {
  const cache = new Map<string, { at: number; ttl: number; candles: Promise<Candle[]> }>();
  const iso = (time: number) => new Date(time).toISOString();

  async function load(account: AccountEntry, symbol: string, { period, ms, from, to }: ChartWindow, at: number) {
    const c = await account.credentials();
    const closed = await broker.candles(c, account.number, symbol, period, iso(from), iso(to));
    const part = partPeriod(broker.timed, ms);
    const last = closed.at(-1);
    if (to + ms <= at || !part || !last) return closed;
    const lastStart = Date.parse(last.time);
    // The bar still open began after the last closed one and less than a bar ago.
    const since = Math.max(lastStart + ms, at - ms);
    const parts = await broker.candles(c, account.number, symbol, part.period, iso(since), iso(at));
    const open = openBar(parts, lastStart, ms);
    return open ? [...closed, open] : closed;
  }

  return {
    get(account, symbol, window) {
      const { period, ms, from, to } = window;
      const key = [account.number, symbol, period, from, to].join("\u0000");
      const hit = cache.get(key);
      if (hit && now() - hit.at < hit.ttl) {
        // Most recently used last, so the oldest is dropped first.
        cache.delete(key);
        cache.set(key, hit);
        return hit.candles;
      }
      const at = now();
      const loaded = load(account, symbol, window, at);
      cache.set(key, { at, ttl: to + ms > at ? LIVE_TTL_MS : CLOSED_TTL_MS, candles: loaded });
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      // Failures are not cached.
      loaded.catch(() => {
        if (cache.get(key)?.candles === loaded) cache.delete(key);
      });
      return loaded;
    },
  };
}
