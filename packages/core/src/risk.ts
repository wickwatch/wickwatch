import type { Deal, Position, Side, TradeDeal, TradePosition } from "./schemas";
import { dealResult, positionGross, round2 } from "./money";

/**
 * What a trade stood to lose at its initial stop loss, in the account currency. The stop distance is valued like the
 * trade's own price move (pnl per price unit), so no contract sizes or pip values are needed and any broker works
 * that reports entry price and initial stop. Undefined when either is missing, the trade closed at its entry price,
 * or the stop does not lie on the losing side (nothing at risk to measure).
 */
export function dealRisk(deal: Deal): number | undefined {
  const { entryPrice, initialStopLoss } = deal;
  if (entryPrice === undefined || initialStopLoss === undefined) return undefined;
  return stopRisk(deal.side, entryPrice, initialStopLoss, deal.price, deal.pnl);
}

/**
 * What an open position stands to lose at its initial stop, valued like dealRisk by its move from entry to the current
 * price and its pnl before costs. Undefined without current price or initial stop, while the price is at the entry,
 * or when the stop does not lie on the losing side.
 */
export function positionRisk(position: Position): number | undefined {
  const { price, initialStopLoss } = position;
  if (price === undefined || initialStopLoss === undefined) return undefined;
  return stopRisk(position.side, position.entry, initialStopLoss, price, positionGross(position));
}

/**
 * The position with its current pnl (including costs) in multiples of its risk, as dealR for a closed trade. Right
 * after the opening the risk is coarse (a pnl in cents over a small move); that only touches the costs' share of the R,
 * as the gross share comes out as the price move over the stop distance whatever the risk.
 */
export function withPositionR(position: Position): TradePosition {
  const risk = positionRisk(position);
  return risk ? { ...position, r: round2(position.pnl / risk) } : position;
}

/** The stop distance valued at the trade's pnl per price unit (`gross` over the move from `entry` to `price`). */
function stopRisk(side: Side, entry: number, initialStop: number, price: number, gross: number): number | undefined {
  const move = price - entry;
  if (move === 0 || gross === 0) return undefined;
  const perUnit = Math.abs(gross / move);
  const stopDistance = (entry - initialStop) * (side === "buy" ? 1 : -1);
  return stopDistance > 0 ? round2(stopDistance * perUnit) : undefined;
}

/** The result including costs in multiples of the risk, e.g. -1 when the initial stop was hit. */
export function dealR(deal: Deal): number | undefined {
  const risk = dealRisk(deal);
  return risk ? round2(dealResult(deal) / risk) : undefined;
}

/**
 * Adds risk, risk in % of the balance before the trade, and R to each deal. The balance before a trade is the current
 * balance minus the results of all account deals closed since (`accountDeals`, the whole account, not one instance);
 * overlapping positions make it an approximation of the balance at entry.
 */
export function withRisk(deals: Deal[], accountDeals: Deal[], balance: number | undefined): TradeDeal[] {
  const beforeAt = balance === undefined ? undefined : balanceBefore(accountDeals, balance);
  return deals.map((deal) => {
    const risk = dealRisk(deal);
    if (risk === undefined) return deal;
    const r = dealR(deal);
    const before = beforeAt?.(deal.time);
    return {
      ...deal,
      risk,
      ...(before !== undefined && before > 0 ? { riskPct: Math.round((risk / before) * 10000) / 100 } : {}),
      ...(r !== undefined ? { r } : {}),
    };
  });
}

/**
 * The balance before a time: `balance` minus the results of the newest account deals, up to (not including) the first
 * one older than `time`. Sorted and summed once, so each lookup is a binary search instead of a walk over all deals.
 */
function balanceBefore(accountDeals: Deal[], balance: number): (time: string) => number {
  const byTime = [...accountDeals].sort((a, b) => b.time.localeCompare(a.time));
  // running[i]: the balance minus the i newest results, subtracted one by one (same rounding as a walk).
  const running = [balance];
  // earliest[i]: the smallest time among the i + 1 newest deals. The walk stops at the first deal with `time <`;
  // collation order and `<` may differ, so the search runs on this running minimum, which only falls.
  const earliest: string[] = [];
  for (const [i, d] of byTime.entries()) {
    running.push((running[i] as number) - dealResult(d));
    const min = earliest[i - 1];
    earliest.push(min !== undefined && min <= d.time ? min : d.time);
  }
  return (time) => {
    let lo = 0;
    let hi = byTime.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((earliest[mid] as string) < time) hi = mid;
      else lo = mid + 1;
    }
    return running[lo] as number;
  };
}
