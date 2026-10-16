import type { Deal, Position } from "./schemas";

/** Commission and swap of a trade, negative as costs. */
export const tradeCosts = (trade: { commission?: number; swap?: number }) =>
  (trade.commission ?? 0) + (trade.swap ?? 0);

/** Result of a deal in the account currency, including commission and swap (a deal's `pnl` is before them). */
export const dealResult = (deal: Deal) => deal.pnl + tradeCosts(deal);

export const round2 = (value: number) => Math.round(value * 100) / 100;

/** P&L of an open position before costs; unlike a deal's, a position's `pnl` includes them. */
export const positionGross = (position: Position) => position.grossPnl ?? round2(position.pnl - tradeCosts(position));

/** What the costs took off an open position's P&L so far; undefined when the broker reports none of them. */
export const positionCosts = (position: Position) =>
  position.grossPnl === undefined && position.commission === undefined && position.swap === undefined
    ? undefined
    : round2(position.pnl - positionGross(position));
