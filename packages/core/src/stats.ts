import type { Deal, DealStats } from "./schemas";

/** Result of a deal in the account currency, including commission and swap. */
export const dealResult = (deal: Deal) => deal.pnl + (deal.commission ?? 0) + (deal.swap ?? 0);

export const round2 = (value: number) => Math.round(value * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Key figures over closing deals. A deal with pnl 0 (typically the opening deal) is not a trade;
 * wins and losses are judged by the result including costs.
 */
export function dealStats(deals: Deal[]): DealStats {
  const results = deals.filter((d) => d.pnl !== 0).map(dealResult);
  const wins = results.filter((r) => r > 0);
  const losses = results.filter((r) => r < 0);
  const grossProfit = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const decided = wins.length + losses.length;
  return {
    trades: results.length,
    wins: wins.length,
    losses: losses.length,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    net: round2(sum(deals.map(dealResult))),
    ...(decided > 0 ? { winRate: wins.length / decided } : {}),
    ...(grossLoss > 0 ? { profitFactor: Math.round((grossProfit / grossLoss) * 100) / 100 } : {}),
    ...(wins.length > 0 ? { averageWin: round2(grossProfit / wins.length) } : {}),
    ...(losses.length > 0 ? { averageLoss: round2(-grossLoss / losses.length) } : {}),
  };
}
