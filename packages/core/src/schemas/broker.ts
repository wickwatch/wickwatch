import Type from "typebox";
import { Id, IsoTime, Side } from "./common";

export const BrokerAccount = Type.Object({
  number: Type.String({ minLength: 1 }),
  broker: Type.String({ minLength: 1 }),
  currency: Type.String({ minLength: 3, maxLength: 3 }),
  live: Type.Boolean(),
  /** False for closed or disabled accounts the broker still lists. Missing: unknown. */
  active: Type.Optional(Type.Boolean()),
  /** Name the broker shows for the account, e.g. a challenge name. */
  name: Type.Optional(Type.String()),
});
export type BrokerAccount = Type.Static<typeof BrokerAccount>;

/** Monetary values are in the account currency. */
export const AccountStats = Type.Object({
  balance: Type.Number(),
  equity: Type.Number(),
  margin: Type.Optional(Type.Number()),
  freeMargin: Type.Optional(Type.Number()),
  time: IsoTime,
});
export type AccountStats = Type.Static<typeof AccountStats>;

/** Volume is in lots; pnl in the account currency. */
export const Position = Type.Object({
  id: Id,
  symbol: Type.String({ minLength: 1 }),
  side: Side,
  volume: Type.Number({ exclusiveMinimum: 0 }),
  entry: Type.Number(),
  sl: Type.Optional(Type.Number()),
  tp: Type.Optional(Type.Number()),
  pnl: Type.Number(),
  /** Order label; equals the instance name per the bot contract. */
  label: Type.Optional(Type.String()),
  openedAt: IsoTime,
});
export type Position = Type.Static<typeof Position>;

export const OrderType = Type.Union([Type.Literal("limit"), Type.Literal("stop"), Type.Literal("stopLimit")]);
export type OrderType = Type.Static<typeof OrderType>;

export const PendingOrder = Type.Object({
  id: Id,
  symbol: Type.String({ minLength: 1 }),
  type: OrderType,
  side: Side,
  volume: Type.Number({ exclusiveMinimum: 0 }),
  price: Type.Number(),
  sl: Type.Optional(Type.Number()),
  tp: Type.Optional(Type.Number()),
  label: Type.Optional(Type.String()),
  /** When the broker cancels the order by itself; unset when it stays until cancelled. */
  expiresAt: Type.Optional(IsoTime),
});
export type PendingOrder = Type.Static<typeof PendingOrder>;

export const Deal = Type.Object({
  id: Id,
  positionId: Id,
  symbol: Type.String({ minLength: 1 }),
  side: Side,
  volume: Type.Number({ exclusiveMinimum: 0 }),
  price: Type.Number(),
  pnl: Type.Number(),
  commission: Type.Optional(Type.Number()),
  swap: Type.Optional(Type.Number()),
  label: Type.Optional(Type.String()),
  time: IsoTime,
});
export type Deal = Type.Static<typeof Deal>;

export const ParameterType = Type.Union([
  Type.Literal("int"),
  Type.Literal("double"),
  Type.Literal("bool"),
  Type.Literal("string"),
  Type.Literal("enum"),
  Type.Literal("time"),
  Type.Literal("symbol"),
  Type.Literal("period"),
  /** Text: `#AARRGGBB` (alpha first), `#RRGGBB` or a colour name like `Blue`. */
  Type.Literal("color"),
]);
export type ParameterType = Type.Static<typeof ParameterType>;

export const ParameterSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  type: ParameterType,
  /** Display name as defined by the bot; not translated. */
  label: Type.Optional(Type.String()),
  group: Type.Optional(Type.String()),
  default: Type.Optional(Type.Unknown()),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  step: Type.Optional(Type.Number()),
  options: Type.Optional(Type.Array(Type.String())),
  /** Numbers behind `options`, same order, where the platform stores enums as numbers. */
  optionValues: Type.Optional(Type.Array(Type.Number())),
});
export type ParameterSchema = Type.Static<typeof ParameterSchema>;

export const AlgoMetadata = Type.Object({
  name: Type.String({ minLength: 1 }),
  version: Type.Optional(Type.String()),
  /** When the algo file was built, if the platform records it. */
  buildTime: Type.Optional(IsoTime),
  /** The algo asks for unrestricted access rights (file system, network) and must be started with them. */
  fullAccess: Type.Optional(Type.Boolean()),
  parameters: Type.Array(ParameterSchema),
});
export type AlgoMetadata = Type.Static<typeof AlgoMetadata>;

export const EmergencyStopResult = Type.Object({
  closed: Type.Integer({ minimum: 0 }),
  cancelled: Type.Integer({ minimum: 0 }),
});
export type EmergencyStopResult = Type.Static<typeof EmergencyStopResult>;
