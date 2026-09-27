import { setTimeout as sleep } from "node:timers/promises";
import {
  AdapterError,
  parseSetupLine,
  toIsoTime,
  type HostStatus,
  type InstanceSpec,
  type LogLevel,
  type LogLine,
  type LogOptions,
  type RuntimeAdapter,
  type RuntimeInstance,
} from "@wickwatch/core";
import { numericId, random, round } from "./random";
import { fromDemoCommand, type DemoInstance, type DemoWorld } from "./world";

const LOG_STEP_MS = 5 * 60 * 1000;
const MAX_TAIL = 1000;
const GIB = 1024 ** 3;

export class DemoRuntimeAdapter implements RuntimeAdapter {
  readonly id = "demo";

  constructor(private readonly world: DemoWorld) {}

  async list(): Promise<RuntimeInstance[]> {
    return [...this.world.instances.values()].map((i) => this.toRuntimeInstance(i));
  }

  async create(spec: InstanceSpec): Promise<RuntimeInstance> {
    if (this.world.instances.has(spec.name)) {
      throw new AdapterError("invalid_input", `Demo instance ${spec.name} already exists`);
    }
    const instance: DemoInstance = {
      ref: spec.name,
      spec,
      ...fromDemoCommand(spec.command),
      status: "stopped",
      restartCount: 0,
    };
    this.world.instances.set(instance.ref, instance);
    return this.toRuntimeInstance(instance);
  }

  async update(ref: string, spec: InstanceSpec): Promise<RuntimeInstance> {
    const instance = this.world.instance(ref);
    Object.assign(instance, { spec, ...fromDemoCommand(spec.command) });
    return this.toRuntimeInstance(instance);
  }

  async remove(ref: string): Promise<void> {
    this.world.instance(ref);
    this.world.instances.delete(ref);
  }

  async start(ref: string): Promise<void> {
    const instance = this.world.instance(ref);
    instance.status = "running";
    instance.startedAt = this.world.now();
  }

  async stop(ref: string): Promise<void> {
    const instance = this.world.instance(ref);
    instance.status = "stopped";
    delete instance.startedAt;
  }

  async restart(ref: string): Promise<void> {
    const instance = this.world.instance(ref);
    instance.status = "running";
    instance.startedAt = this.world.now();
    instance.restartCount += 1;
  }

  async *logs(ref: string, opts: LogOptions = {}): AsyncIterable<LogLine> {
    const instance = this.world.instance(ref);
    const tail = Math.min(opts.tail ?? 100, MAX_TAIL);
    const last = Math.floor(this.world.now().getTime() / LOG_STEP_MS);
    let first = last - tail + 1;
    if (opts.since) first = Math.max(first, Math.ceil(Date.parse(opts.since) / LOG_STEP_MS));

    for (let slot = first; slot <= last; slot++) {
      yield this.logLine(instance, new Date(slot * LOG_STEP_MS), slot);
    }
    if (!opts.follow) return;

    for (let n = 0; !opts.signal?.aborted; n++) {
      try {
        await sleep(this.world.logIntervalMs, undefined, opts.signal ? { signal: opts.signal } : {});
      } catch {
        return;
      }
      if (instance.status === "running") yield this.logLine(instance, this.world.now(), `live-${n}`);
    }
  }

  async hostStatus(): Promise<HostStatus> {
    const minute = Math.floor(this.world.now().getTime() / 60_000);
    const diskTotal = 80 * GIB;
    return {
      cpu: round(0.1 + 0.08 * random(this.world.seed, "cpu", minute), 3),
      memUsed: Math.round((1.35 + 0.1 * random(this.world.seed, "mem", minute)) * GIB),
      memTotal: 4 * GIB,
      diskUsed: Math.round(0.38 * diskTotal),
      diskTotal,
      ntpSynced: true,
    };
  }

  private toRuntimeInstance(instance: DemoInstance): RuntimeInstance {
    return {
      ref: instance.ref,
      labels: { ...instance.spec.labels },
      status: instance.status,
      restartCount: instance.restartCount,
      image: instance.spec.image,
      ...(instance.startedAt ? { startedAt: toIsoTime(instance.startedAt) } : {}),
    };
  }

  /** Bot output stays untranslated, like real bot logs. */
  private logLine(instance: DemoInstance, time: Date, key: string | number): LogLine {
    const { algo, symbol } = instance;
    const { name } = instance.spec;
    const r = random(this.world.seed, name, "log", key);
    let text: string;
    let level: LogLevel = "info";

    if (instance.status === "error") {
      text = r < 0.5 ? "Login failed: invalid password" : "Connection closed, retrying in 30 s";
      level = r < 0.5 ? "error" : "warn";
    } else if (r < 0.08) {
      const price = this.world.price(symbol, time);
      const side = r < 0.04 ? "long" : "short";
      text = `WW-SETUP ${JSON.stringify({
        label: name,
        positionId: numericId(this.world.seed, name, "setup", key),
        signal: side,
        features: { price, atr: round(20 + 30 * random(this.world.seed, name, "atr", key), 1), session: "eu" },
      })}`;
    } else if (r < 0.14) {
      text = "Spread above limit, entry skipped";
      level = "warn";
    } else if (r < 0.3) {
      text = `Signal confirmed on ${symbol} at ${this.world.price(symbol, time)}`;
    } else if (r < 0.4) {
      text = `${algo.name} ${algo.version} heartbeat`;
    } else {
      text = "Waiting for signal, trading window open";
    }

    const setup = parseSetupLine(text);
    return { time: toIsoTime(time), text, level, ...(setup ? { setup } : {}) };
  }
}
