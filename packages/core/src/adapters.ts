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
  LogEvent,
  LogLine,
  OptimizationRange,
  ParameterFile,
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
  /** `parameters`: the algo's schema, e.g. to store enums the way the platform expects. */
  algo: { name: string; file: Uint8Array; fullAccess: boolean; parameters: ParameterSchema[] };
  symbol: string;
  period: string;
  parameters: ParameterValues;
}

/** A helper program run on demand, e.g. a broker CLI in a throwaway container. */
export interface ToolSpec {
  /** Pinned image, never `latest`. */
  image: string;
  command: string[];
  /** Placed before the start; may hold secrets. */
  files: InstanceFile[];
}

/** A running tool. stdout and stderr arrive together as text. */
export interface ToolProcess {
  write(text: string): void;
  onOutput(listener: (text: string) => void): void;
  /** Resolves with the exit code (null if unknown) once the tool has ended and was cleaned up. */
  readonly exit: Promise<number | null>;
  kill(): void;
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
  /** Runs a helper program next to the instances; missing when the runtime cannot. Tools are not instances. */
  runTool?(spec: ToolSpec): Promise<ToolProcess>;
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
  /**
   * Version of what `algoMetadata` reads. Bump it when the reader learns more (a new field, a fixed type): the server
   * then reads stored algos again once at start, instead of the user re-uploading them. Missing means 0.
   */
  readonly algoMetadataVersion?: number;
  /** How to run an algo on an account; missing when this broker cannot run bots itself. */
  launch?(input: LaunchInput): Promise<Launch>;
  /** Timeframes an instance can run on (e.g. `m5`, `h1`); without it the period is free text. */
  periods?(): string[];
  /** Recognises platform events in a line an instance logged, e.g. a lost broker connection. */
  logEvent?(text: string): LogEvent | undefined;
  /** Hides secrets the platform prints in an instance's log, e.g. a licence key among the parameters at start. */
  redactLog?(text: string): string;
  /** Releases long-lived resources (sessions, processes) on shutdown. */
  dispose?(): Promise<void>;
}

/** Reads and writes the parameter files of a trading platform (e.g. `.cbotset`). */
export interface ConfigAdapter {
  readonly id: string;
  /** File extensions without dot, e.g. `cbotset`; the first one is used for downloads. */
  formats(): string[];
  /** A file uploaded for an algo. A file that is not in the format at all: `invalid_input`. */
  parse(content: Uint8Array, schema: ParameterSchema[]): ParameterFile;
  /** The file for a configuration, e.g. to open it in the platform or to back it up. */
  serialize(values: ParameterValues, schema: ParameterSchema[], chart: { symbol: string; period: string }): Uint8Array;
  validate(values: ParameterValues, schema: ParameterSchema[]): ValidationResult;
  exportOptimization?(values: ParameterValues, ranges: Record<string, OptimizationRange>): Promise<string>;
}
