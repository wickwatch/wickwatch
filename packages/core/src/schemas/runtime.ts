import Type from "typebox";
import { Id, IsoTime, Labels } from "./common";

export const InstanceStatus = Type.Union([
  Type.Literal("running"),
  Type.Literal("stopped"),
  Type.Literal("restarting"),
  Type.Literal("error"),
  Type.Literal("unknown"),
]);
export type InstanceStatus = Type.Static<typeof InstanceStatus>;

export const RuntimeInstance = Type.Object({
  /** Runtime id, e.g. a container name. */
  ref: Type.String({ minLength: 1 }),
  labels: Labels,
  status: InstanceStatus,
  startedAt: Type.Optional(IsoTime),
  restartCount: Type.Integer({ minimum: 0 }),
  /** Pinned runtime image version. */
  image: Type.Optional(Type.String()),
});
export type RuntimeInstance = Type.Static<typeof RuntimeInstance>;

export const InstanceSpec = Type.Object({
  name: Type.String({ minLength: 1 }),
  accountId: Id,
  algo: Type.Object({
    name: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
  }),
  symbol: Type.String({ minLength: 1 }),
  period: Type.String({ minLength: 1 }),
  /** Path to the parameter set. */
  parameterFile: Type.String({ minLength: 1 }),
  labels: Labels,
});
export type InstanceSpec = Type.Static<typeof InstanceSpec>;

export const LogLevel = Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")]);
export type LogLevel = Type.Static<typeof LogLevel>;

export const LogLine = Type.Object({
  time: IsoTime,
  text: Type.String(),
  level: Type.Optional(LogLevel),
  /** Parsed `WW-SETUP` payload, see docs/BOT-CONTRACT.md. */
  setup: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type LogLine = Type.Static<typeof LogLine>;

export const HostStatus = Type.Object({
  /** CPU load as a fraction, 0..1. */
  cpu: Type.Number({ minimum: 0, maximum: 1 }),
  memUsed: Type.Number({ minimum: 0 }),
  memTotal: Type.Number({ minimum: 0 }),
  diskUsed: Type.Number({ minimum: 0 }),
  diskTotal: Type.Number({ minimum: 0 }),
  ntpSynced: Type.Boolean(),
});
export type HostStatus = Type.Static<typeof HostStatus>;
