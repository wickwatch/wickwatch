import type {
  AccountStats,
  AlgoMetadata,
  BrokerAccount,
  Capabilities,
  Deal,
  EmergencyStopResult,
  HostStatus,
  Id,
  InstanceSpec,
  IsoTime,
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

/** Runs bot instances (e.g. Docker containers). */
export interface RuntimeAdapter {
  readonly id: string;
  list(): Promise<RuntimeInstance[]>;
  create(spec: InstanceSpec): Promise<RuntimeInstance>;
  update(ref: string, spec: InstanceSpec): Promise<RuntimeInstance>;
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
