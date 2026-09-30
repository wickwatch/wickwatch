import Type from "typebox";
import { IsoTime, Labels } from "./common";

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
  /** Exit code of the last run, for an instance that ran and ended; missing while running or before its first start. */
  exitCode: Type.Optional(Type.Integer()),
});
export type RuntimeInstance = Type.Static<typeof RuntimeInstance>;

export const LogLevel = Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")]);
export type LogLevel = Type.Static<typeof LogLevel>;

/** Platform events a broker adapter recognises in an instance's log. */
export const LogEvent = Type.Union([
  Type.Literal("connection_lost"),
  Type.Literal("connection_restored"),
  /** The algo threw an error but keeps running (e.g. an exception in an event handler). */
  Type.Literal("algo_crashed"),
  /** The algo ended itself (its own decision, e.g. a daily limit), as opposed to being stopped from outside. */
  Type.Literal("algo_stopped"),
]);
export type LogEvent = Type.Static<typeof LogEvent>;

export const LogLine = Type.Object({
  time: IsoTime,
  text: Type.String(),
  level: Type.Optional(LogLevel),
  event: Type.Optional(LogEvent),
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
  /** Missing when the adapter cannot tell. */
  ntpSynced: Type.Optional(Type.Boolean()),
  /** Measured offset of the server clock from an external time source in ms, positive when it runs ahead. */
  clockOffsetMs: Type.Optional(Type.Number()),
});
export type HostStatus = Type.Static<typeof HostStatus>;
