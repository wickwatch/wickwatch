import { dealResult, round2 } from "./money";
import { dealR } from "./risk";
import type { Deal, DealStats } from "./schemas";

export { dealResult, round2 } from "./money";
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Key figures over closing deals. A deal with pnl 0 (typically the opening deal) is not a trade;
 * wins and losses are judged by the result including costs.
 */
export function dealStats(deals: Deal[]): DealStats {
  const results = deals.filter((d) => d.pnl !== 0).map(dealResult);
  const rs = deals.map(dealR).filter((r): r is number => r !== undefined);
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
    ...(grossLoss > 0 ? { profitFactor: round2(grossProfit / grossLoss) } : {}),
    ...(wins.length > 0 ? { averageWin: round2(grossProfit / wins.length) } : {}),
    ...(losses.length > 0 ? { averageLoss: round2(-grossLoss / losses.length) } : {}),
    ...(rs.length > 0 ? { averageR: round2(sum(rs) / rs.length), totalR: round2(sum(rs)), rTrades: rs.length } : {}),
  };
}
