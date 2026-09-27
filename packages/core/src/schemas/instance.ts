import Type from "typebox";
import { AdapterErrorCode } from "../errors";
import { IsoTime, Labels } from "./common";
import { Deal, PendingOrder, Position } from "./broker";
import { InstanceSummary } from "./overview";

/** Key figures over closed trades; averages and ratios are missing when there is no data for them. */
export const DealStats = Type.Object({
  trades: Type.Integer({ minimum: 0 }),
  wins: Type.Integer({ minimum: 0 }),
  losses: Type.Integer({ minimum: 0 }),
  /** 0..1 */
  winRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  /** Gross profit / gross loss; missing without losing trades. */
  profitFactor: Type.Optional(Type.Number({ minimum: 0 })),
  averageWin: Type.Optional(Type.Number()),
  averageLoss: Type.Optional(Type.Number()),
  grossProfit: Type.Number(),
  grossLoss: Type.Number(),
  /** Including commission and swap. */
  net: Type.Number(),
});
export type DealStats = Type.Static<typeof DealStats>;

export const InstanceDetail = Type.Object({
  time: IsoTime,
  instance: Type.Intersect([InstanceSummary, Type.Object({ labels: Labels, image: Type.Optional(Type.String()) })]),
  account: Type.Optional(
    Type.Object({ number: Type.String(), displayName: Type.String(), currency: Type.Optional(Type.String()) }),
  ),
  /** Set when the broker could not be queried; positions, orders and deals are then empty. */
  brokerError: Type.Optional(AdapterErrorCode),
  positions: Type.Array(Position),
  pendingOrders: Type.Array(PendingOrder),
  /** Deals of this instance in the range, oldest first. */
  deals: Type.Array(Deal),
  /** Positions and deals the rules would attribute here, but removed by hand (e.g. manual trades). */
  excludedPositions: Type.Array(Position),
  excludedDeals: Type.Array(Deal),
  stats: DealStats,
  range: Type.Object({ from: IsoTime, to: IsoTime }),
});
export type InstanceDetail = Type.Static<typeof InstanceDetail>;
