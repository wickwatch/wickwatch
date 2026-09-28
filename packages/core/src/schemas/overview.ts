import Type from "typebox";
import { AdapterErrorCode } from "../errors";
import { Capabilities } from "./capabilities";
import { ChallengeEvaluation } from "./challenge";
import { IsoTime } from "./common";
import { InstanceStatus, LogLine } from "./runtime";

// Views for the overview screen, derived from adapter data by buildOverview().

export const AccountState = Type.Union([
  Type.Literal("running"),
  Type.Literal("attention"),
  Type.Literal("stopped"),
  Type.Literal("idle"),
  Type.Literal("error"),
]);
export type AccountState = Type.Static<typeof AccountState>;

export const AlgoCrashes = Type.Object({
  count: Type.Integer({ minimum: 1 }),
  /** Time and log line of the latest one. */
  lastAt: IsoTime,
  lastText: Type.String(),
});
export type AlgoCrashes = Type.Static<typeof AlgoCrashes>;

/** What an instance's log says beyond its runtime status; collected by the server. */
export interface InstanceLogState {
  connectionLostSince?: IsoTime;
  crashes?: AlgoCrashes;
}

export const InstanceSummary = Type.Object({
  ref: Type.String(),
  name: Type.String(),
  account: Type.Optional(Type.String()),
  symbol: Type.Optional(Type.String()),
  period: Type.Optional(Type.String()),
  status: InstanceStatus,
  startedAt: Type.Optional(IsoTime),
  restartCount: Type.Integer({ minimum: 0 }),
  openPositions: Type.Integer({ minimum: 0 }),
  /** Realised P&L since the start of the day plus open P&L, in the account currency. */
  dayPnl: Type.Number(),
  lastLog: Type.Optional(LogLine),
  /** The instance runs but logged that its broker connection is lost, at this time. */
  connectionLostSince: Type.Optional(IsoTime),
  /** Errors the algo threw since the instance started, while it kept running. */
  crashes: Type.Optional(AlgoCrashes),
});
export type InstanceSummary = Type.Static<typeof InstanceSummary>;

export const AccountSummary = Type.Object({
  number: Type.String(),
  displayName: Type.String(),
  broker: Type.Optional(Type.String()),
  currency: Type.Optional(Type.String()),
  credentialLabel: Type.Optional(Type.String()),
  state: AccountState,
  /** Set when the broker could not be queried; the numbers below are then missing. */
  error: Type.Optional(AdapterErrorCode),
  balance: Type.Optional(Type.Number()),
  equity: Type.Optional(Type.Number()),
  dayPnl: Type.Optional(Type.Number()),
  openPositions: Type.Integer({ minimum: 0 }),
  instances: Type.Object({ total: Type.Integer({ minimum: 0 }), running: Type.Integer({ minimum: 0 }) }),
  /** Present when the account has a challenge profile and the broker could be queried. */
  challenge: Type.Optional(ChallengeEvaluation),
});
export type AccountSummary = Type.Static<typeof AccountSummary>;

export const AlertCode = Type.Union([
  Type.Literal("instance_error"),
  Type.Literal("instance_stopped"),
  Type.Literal("instance_disconnected"),
  Type.Literal("instance_crashed"),
  Type.Literal("account_error"),
  Type.Literal("challenge_breached"),
  Type.Literal("challenge_limit"),
  Type.Literal("challenge_passed"),
  Type.Literal("challenge_guard"),
  Type.Literal("attribution_ambiguous"),
  Type.Literal("attribution_invalid"),
]);
export type AlertCode = Type.Static<typeof AlertCode>;

/** `code` and `params` map to an i18n message; `subject` is the instance name or account number. */
export const Alert = Type.Object({
  level: Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info")]),
  code: AlertCode,
  subject: Type.String(),
  params: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
});
export type Alert = Type.Static<typeof Alert>;

export const Overview = Type.Object({
  time: IsoTime,
  accounts: Type.Array(AccountSummary),
  instances: Type.Array(InstanceSummary),
  alerts: Type.Array(Alert),
});
export type Overview = Type.Static<typeof Overview>;

export const EmergencyStopReport = Type.Object({
  stoppedInstances: Type.Array(Type.String()),
  /** Instances that could not be stopped; positions are closed anyway. */
  failedInstances: Type.Array(Type.String()),
  closed: Type.Integer({ minimum: 0 }),
  cancelled: Type.Integer({ minimum: 0 }),
});
export type EmergencyStopReport = Type.Static<typeof EmergencyStopReport>;

export const SystemInfo = Type.Object({
  version: Type.String(),
  defaultLocale: Type.String(),
  labelPrefix: Type.String(),
  adapters: Type.Object({ runtime: Type.String(), broker: Type.String(), config: Type.String() }),
  /** The UI hides features the broker adapter does not support. */
  capabilities: Capabilities,
  /** Timeframes offered by the broker adapter, if it knows them. */
  periods: Type.Optional(Type.Array(Type.String())),
});
export type SystemInfo = Type.Static<typeof SystemInfo>;
