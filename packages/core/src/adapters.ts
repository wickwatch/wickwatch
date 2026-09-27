import type {
  AccountStats,
  AlgoMetadata,
  BrokerAccount,
  Capabilities,
  Deal,
  EmergencyStopResult,
  HostStatus,
  Id,
  IsoTime,
  Labels,
  LogLine,
  OptimizationRange,
  ParameterSchema,
  ParameterValues,
  PendingOrder,
  Position,
  RuntimeInstance,
  ValidationResult,
} from "./schemas";

/** Broker credentials. Decrypted only in memory; never logged, never serialised. */
export interface Credentials {
  login: string;
  secret: string;
}

export interface LogOptions {
  since?: IsoTime;
  tail?: number;
  /** Keep the iterator open and yield new lines until `signal` aborts. */
  follow?: boolean;
  signal?: AbortSignal;
}

/** A file placed into an instance before it starts. May hold secrets: never log or serialise it. */
export interface InstanceFile {
  /** Absolute path inside the instance, e.g. `/mnt/wickwatch/bot.algo`. */
  path: string;
  content: Uint8Array;
  /** Unix permissions, e.g. 0o400 for a password file. */
  mode: number;
}

/** How a broker platform runs an algo: the runtime needs nothing else. */
export interface Launch {
  /** Pinned image, never `latest`. */
  image: string;
  command: string[];
  files: InstanceFile[];
}

/** Everything a runtime needs to create an instance. The core adds the labels to a broker's Launch. */
export interface InstanceSpec extends Launch {
  /** Runtime ref, e.g. the container name. */
  name: string;
  labels: Labels;
}

export interface LaunchInput {
  credentials: Credentials;
  account: string;
  algo: { name: string; file: Uint8Array; fullAccess: boolean };
  symbol: string;
  period: string;
  parameters: ParameterValues;
}

/** Runs bot instances (e.g. Docker containers). */
export interface RuntimeAdapter {
  readonly id: string;
  list(): Promise<RuntimeInstance[]>;
  /** Creates a stopped instance. Only instances created this way may be updated or removed. */
  create(spec: InstanceSpec): Promise<RuntimeInstance>;
  /** Replaces an instance created by `create`; a running instance keeps running with the new spec. */
  update(ref: string, spec: InstanceSpec): Promise<RuntimeInstance>;
  /** Stops and removes an instance created by `create`. */
  remove(ref: string): Promise<void>;
  start(ref: string): Promise<void>;
  stop(ref: string): Promise<void>;
  restart(ref: string): Promise<void>;
  logs(ref: string, opts?: LogOptions): AsyncIterable<LogLine>;
  hostStatus(): Promise<HostStatus>;
}

/**
 * Accounts and trading data. `emergencyStop` only covers the broker side
 * (close positions, cancel orders); stopping the instances is done by the core.
 */
export interface BrokerAdapter {
  readonly id: string;
  capabilities(): Capabilities;
  accounts(c: Credentials): Promise<BrokerAccount[]>;
  symbols(c: Credentials, account: string): Promise<string[]>;
  stats(c: Credentials, account: string): Promise<AccountStats>;
  positions(c: Credentials, account: string): Promise<Position[]>;
  pendingOrders(c: Credentials, account: string): Promise<PendingOrder[]>;
  deals(c: Credentials, account: string, from: IsoTime, to: IsoTime): Promise<Deal[]>;
  closePosition(c: Credentials, account: string, positionId: Id): Promise<void>;
  cancelOrder(c: Credentials, account: string, orderId: Id): Promise<void>;
  emergencyStop(c: Credentials, account: string): Promise<EmergencyStopResult>;
  algoMetadata(algoPath: string): Promise<AlgoMetadata>;
  /** How to run an algo on an account; missing when this broker cannot run bots itself. */
  launch?(input: LaunchInput): Promise<Launch>;
  /** Timeframes an instance can run on (e.g. `m5`, `h1`); without it the period is free text. */
  periods?(): string[];
  /** Releases long-lived resources (sessions, processes) on shutdown. */
  dispose?(): Promise<void>;
}

/** Reads and writes parameter files. */
export interface ConfigAdapter {
  readonly id: string;
  formats(): string[];
  read(path: string): Promise<ParameterValues>;
  write(path: string, values: ParameterValues): Promise<void>;
  validate(values: ParameterValues, schema: ParameterSchema[]): ValidationResult;
  exportOptimization?(values: ParameterValues, ranges: Record<string, OptimizationRange>): Promise<string>;
}
