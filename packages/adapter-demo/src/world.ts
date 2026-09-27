import {
  AdapterError,
  buildLabels,
  DEFAULT_LABEL_PREFIX,
  type InstanceSpec,
  type InstanceStatus,
  type ParameterValues,
} from "@wickwatch/core";
import { random, round } from "./random";
import {
  ACCOUNTS,
  ALGOS,
  algoPath,
  INSTANCES,
  parameterFile,
  SYMBOLS,
  type DemoAccount,
  type DemoAlgo,
  type DemoSymbol,
} from "./world-data";

export interface DemoOptions {
  /** Changes all generated data; the same seed and clock always produce the same data. */
  seed?: number;
  /** Clock used for all generated data. Defaults to the real time. */
  now?: () => Date;
  labelPrefix?: string;
  /** Delay between live log lines when following logs. */
  logIntervalMs?: number;
}

export interface DemoInstance {
  ref: string;
  spec: InstanceSpec;
  algo: { name: string; version: string };
  symbol: string;
  status: InstanceStatus;
  startedAt?: Date;
  restartCount: number;
}

const HOUR_MS = 60 * 60 * 1000;

export const DEMO_IMAGE = "wickwatch-demo-runtime:1.0.0";

/** Command of a demo instance; the demo runtime reads algo and symbol back from it. */
export function demoCommand(algo: string, account: string, symbol: string, period: string): string[] {
  return ["run", algo, `--account=${account}`, `--symbol=${symbol}`, `--period=${period}`];
}

/** Algo name, version and symbol of a demo command. */
export function fromDemoCommand(command: string[]): { algo: { name: string; version: string }; symbol: string } {
  const [, name = "bot", version = "0"] = /(?:^|\/)([^/]+)\/([^/]+)\/[^/]+\.algo$/.exec(command[1] ?? "") ?? [];
  const symbol = command.find((a) => a.startsWith("--symbol="))?.slice("--symbol=".length) ?? "EURUSD";
  return { algo: { name, version }, symbol };
}

/** Mutable state shared by the demo runtime, broker and config adapters. */
export class DemoWorld {
  readonly seed: number;
  readonly now: () => Date;
  readonly labelPrefix: string;
  readonly logIntervalMs: number;

  readonly instances = new Map<string, DemoInstance>();
  readonly closedPositions = new Set<string>();
  readonly cancelledOrders = new Set<string>();
  readonly files = new Map<string, ParameterValues>();

  constructor(options: DemoOptions = {}) {
    this.seed = options.seed ?? 1;
    this.now = options.now ?? (() => new Date());
    this.labelPrefix = options.labelPrefix ?? DEFAULT_LABEL_PREFIX;
    this.logIntervalMs = options.logIntervalMs ?? 2000;

    const now = this.now().getTime();
    for (const seed of INSTANCES) {
      const algo = this.algo(seed.algo);
      const account = this.account(seed.account);
      const file = parameterFile(seed.name);
      const spec: InstanceSpec = {
        name: seed.name,
        image: DEMO_IMAGE,
        command: demoCommand(algoPath(seed.algo, algo.version), seed.account, seed.symbol, seed.period),
        files: [],
        labels: buildLabels(this.labelPrefix, {
          instance: seed.name,
          account: seed.account,
          ...(account.prop ? { prop: account.prop } : {}),
          symbol: seed.symbol,
          period: seed.period,
          set: seed.name,
          "algo-version": algo.version,
        }),
      };
      this.instances.set(seed.name, {
        ref: seed.name,
        spec,
        algo: { name: seed.algo, version: algo.version },
        symbol: seed.symbol,
        status: seed.status,
        restartCount: seed.restartCount,
        ...(seed.status === "running" ? { startedAt: new Date(now - seed.uptimeHours * HOUR_MS) } : {}),
      });
      this.files.set(file, Object.fromEntries(algo.parameters.map((p) => [p.name, p.default])));
    }
  }

  account(number: string): DemoAccount {
    const account = ACCOUNTS.find((a) => a.number === number);
    if (!account) throw new AdapterError("not_found", `Unknown demo account ${number}`);
    return account;
  }

  algo(name: string): DemoAlgo {
    const algo = ALGOS[name];
    if (!algo) throw new AdapterError("not_found", `Unknown demo algo ${name}`);
    return algo;
  }

  instance(ref: string): DemoInstance {
    const instance = this.instances.get(ref);
    if (!instance) throw new AdapterError("not_found", `Unknown demo instance ${ref}`);
    return instance;
  }

  symbol(name: string): DemoSymbol {
    const symbol = SYMBOLS[name];
    if (!symbol) throw new AdapterError("not_found", `Unknown demo symbol ${name}`);
    return symbol;
  }

  /** Smooth, deterministic price curve made of three sine waves. */
  price(symbol: string, time: Date): number {
    const s = this.symbol(symbol);
    const hours = time.getTime() / HOUR_MS;
    const phase = random(this.seed, symbol) * 2 * Math.PI;
    const wave =
      0.006 * Math.sin((hours / 24) * 2 * Math.PI + phase) +
      0.002 * Math.sin((hours / 1.7) * 2 * Math.PI + 2 * phase) +
      0.0007 * Math.sin(hours * 3.1 * 2 * Math.PI + phase);
    return round(s.price * (1 + wave), s.digits);
  }
}
