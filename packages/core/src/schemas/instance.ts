import Type from "typebox";
import { AdapterErrorCode } from "../errors";
import { IsoTime, Labels } from "./common";
import { Deal, PendingOrder, Position } from "./broker";
import { Attributed, InstanceSummary } from "./overview";

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
  /** R over the trades whose risk is known (see risk.ts); `rTrades` counts them. */
  averageR: Type.Optional(Type.Number()),
  totalR: Type.Optional(Type.Number()),
  rTrades: Type.Optional(Type.Integer({ minimum: 0 })),
  grossProfit: Type.Number(),
  grossLoss: Type.Number(),
  /** Including commission and swap. */
  net: Type.Number(),
});
export type DealStats = Type.Static<typeof DealStats>;

/**
 * A closing deal with what it risked, when its initial stop loss is known: `risk` in the account currency, `riskPct`
 * of the balance before the trade, `r` the result in multiples of the risk.
 */
export const TradeDeal = Type.Object({
  ...Deal.properties,
  risk: Type.Optional(Type.Number()),
  riskPct: Type.Optional(Type.Number()),
  r: Type.Optional(Type.Number()),
});
export type TradeDeal = Type.Static<typeof TradeDeal>;
/** A deal of the account with the instance it belongs to, as for AccountPosition. */
export const AccountDeal = Type.Object({ ...TradeDeal.properties, ...Attributed.properties });
export type AccountDeal = Type.Static<typeof AccountDeal>;
/** The deals of one account in a time range, oldest first, whatever instance they belong to. */
export const AccountDeals = Type.Object({
  range: Type.Object({ from: IsoTime, to: IsoTime }),
  deals: Type.Array(AccountDeal),
});
export type AccountDeals = Type.Static<typeof AccountDeals>;

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
  deals: Type.Array(TradeDeal),
  /** Positions and deals the rules would attribute here, but removed by hand (e.g. manual trades). */
  excludedPositions: Type.Array(Position),
  excludedDeals: Type.Array(Deal),
  stats: DealStats,
  range: Type.Object({ from: IsoTime, to: IsoTime }),
  /** When this instance's first trade wickwatch knows closed, also before the range; unset while unknown. */
  firstTradeAt: Type.Optional(IsoTime),
});
export type InstanceDetail = Type.Static<typeof InstanceDetail>;
