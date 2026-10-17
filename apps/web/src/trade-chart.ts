import type { PositionLevels, Side } from "@wickwatch/core";

/** A bar of a line in the trade chart: its opening time in seconds and the level then, missing while none was set. */
export interface LinePoint {
  time: number;
  value?: number;
}

export interface TradeLines {
  /** Bar the trade opened in, seconds. */
  opened: number;
  /** Bar it closed in; missing while open. */
  closed?: number;
  /** Stop loss and take profit per bar from the opening to the close (or the last bar). */
  sl: LinePoint[];
  tp: LinePoint[];
  /** Bar the stop first reached the entry or beyond: break even (or profit) is locked in. */
  breakEven?: number;
}

export interface TradeLinesInput {
  /** Opening times of the candles in seconds, oldest first. */
  bars: readonly number[];
  side: Side;
  entry?: number | undefined;
  openedAt: string;
  /** Missing while the position is open. */
  closedAt?: string | undefined;
  /** The stop it opened with, when known (from the broker, or the server's first stop seen right at the opening). */
  initialStopLoss?: number | undefined;
  levels: readonly PositionLevels[];
  /** An open position's levels now; newer than the last ones wickwatch stored. */
  current?: { sl?: number | undefined; tp?: number | undefined };
}

/** The bar a moment (ms) falls in: the last one opening at or before it, else the first. */
export function barAt(bars: readonly number[], ms: number): number | undefined {
  const seconds = ms / 1000;
  let found = bars[0];
  for (const bar of bars) {
    if (bar > seconds) break;
    found = bar;
  }
  return found;
}

/**
 * Where the trade's stop loss and take profit were, bar by bar. Levels are dated when wickwatch noticed them, so a
 * change shows in the bar of that moment; several in one bar show as the last.
 */
export function tradeLines(input: TradeLinesInput): TradeLines | undefined {
  const { bars, levels } = input;
  const last = bars.at(-1);
  if (last === undefined) return undefined;
  const openedMs = Date.parse(input.openedAt);
  const opened = barAt(bars, openedMs) ?? last;
  const end = input.closedAt === undefined ? last : (barAt(bars, Date.parse(input.closedAt)) ?? last);

  /**
   * Changes of one level in time (ms), from the opening: there only the initial stop is known (from the broker or
   * seen right after the opening), else the line starts where wickwatch first saw a level.
   */
  const steps = (field: "sl" | "tp", start: number | undefined, now: number | undefined) => [
    { ms: openedMs, value: start },
    ...levels.filter((l) => Date.parse(l.at) > openedMs).map((l) => ({ ms: Date.parse(l.at), value: l[field] })),
    // Last, whatever time the bars end at: the broker's answer now is newer than every level stored.
    ...(input.closedAt === undefined && input.current ? [{ ms: Number.MAX_SAFE_INTEGER, value: now }] : []),
  ];
  const perBar = (changes: { ms: number; value: number | undefined }[]): LinePoint[] => {
    // Oldest first, so one pass over the bars takes each change in turn (a trailed stop has many).
    let next = 0;
    let value: number | undefined;
    return bars.flatMap((bar, index) => {
      if (bar < opened || bar > end) return [];
      // A change belongs to the bar it happened in: before the next bar opens (also over a weekend gap).
      const nextBar = (bars[index + 1] ?? Infinity) * 1000;
      for (let change = changes[next]; change && change.ms < nextBar; change = changes[++next]) value = change.value;
      return [value === undefined ? { time: bar } : { time: bar, value }];
    });
  };

  const slSteps = steps("sl", input.initialStopLoss, input.current?.sl);
  const entry = input.entry;
  const locked = (sl: number | undefined) =>
    entry !== undefined && sl !== undefined && (input.side === "buy" ? sl >= entry : sl <= entry);
  // Only a stop moved there counts: one first seen beyond the entry was never a risk, or moved before it was seen.
  const firstStop = slSteps.find((s) => s.value !== undefined)?.value;
  const breakEvenAt = locked(firstStop) ? undefined : slSteps.find((s) => locked(s.value))?.ms;
  const breakEven = breakEvenAt === undefined ? undefined : barAt(bars, breakEvenAt);

  return {
    opened,
    ...(input.closedAt === undefined ? {} : { closed: end }),
    sl: perBar(slSteps),
    tp: perBar(steps("tp", undefined, input.current?.tp)),
    ...(breakEven === undefined ? {} : { breakEven }),
  };
}
