import type { StatsFs } from "node:fs";
import { readFile, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { availableParallelism, freemem, loadavg, totalmem } from "node:os";
import {
  AdapterError,
  DEFAULT_LABEL_PREFIX,
  labelKey,
  type HostStatus,
  type InstanceSpec,
  type InstanceStatus,
  type LogLine,
  type LogOptions,
  type RuntimeAdapter,
  type RuntimeInstance,
} from "@wickwatch/core";
import { createDockerClient, type ContainerDetails, type ContainerHandle, type DockerClient } from "./client";
import { demux, splitLines, toLogLine } from "./logs";

export interface DockerRuntimeOptions {
  /** e.g. tcp://socket-proxy:2375; defaults to the local socket. */
  dockerHost?: string;
  labelPrefix?: string;
  /** Directory whose file system is reported as disk usage (the data directory). */
  diskPath?: string;
  client?: DockerClient;
  now?: () => Date;
}

const MAX_TAIL = 1000;
/** Exit codes after SIGINT, SIGKILL, SIGTERM: a deliberate stop, not a crash. */
const STOP_EXIT_CODES = new Set([130, 137, 143]);

/**
 * Runtime adapter for Docker. Instances are containers carrying the label `<prefix>.instance`;
 * containers without it are invisible, so the API can never act on unrelated containers.
 */
export class DockerRuntimeAdapter implements RuntimeAdapter {
  readonly id = "docker";
  private readonly client: DockerClient;
  private readonly instanceLabel: string;
  private readonly diskPath: string;
  private readonly now: () => Date;

  constructor(options: DockerRuntimeOptions = {}) {
    this.client = options.client ?? createDockerClient(options.dockerHost);
    this.instanceLabel = labelKey(options.labelPrefix ?? DEFAULT_LABEL_PREFIX, "instance");
    this.diskPath = options.diskPath ?? process.cwd();
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<RuntimeInstance[]> {
    const summaries = await call(() => this.client.listByLabel(this.instanceLabel));
    const details = await Promise.all(
      summaries.map((s) => call(() => this.client.container(s.Id).inspect()).catch(() => undefined)),
    );
    return details
      .filter((d): d is ContainerDetails => d !== undefined)
      .map((d) => toRuntimeInstance(d))
      .sort((a, b) => a.ref.localeCompare(b.ref));
  }

  create(_spec: InstanceSpec): Promise<RuntimeInstance> {
    return Promise.reject(unsupported());
  }

  update(_ref: string, _spec: InstanceSpec): Promise<RuntimeInstance> {
    return Promise.reject(unsupported());
  }

  remove(_ref: string): Promise<void> {
    return Promise.reject(unsupported());
  }

  async start(ref: string): Promise<void> {
    const { handle } = await this.managed(ref);
    await callIdempotent(() => handle.start());
  }

  async stop(ref: string): Promise<void> {
    const { handle } = await this.managed(ref);
    await callIdempotent(() => handle.stop());
  }

  async restart(ref: string): Promise<void> {
    const { handle } = await this.managed(ref);
    await call(() => handle.restart());
  }

  async *logs(ref: string, opts: LogOptions = {}): AsyncIterable<LogLine> {
    const { handle, details } = await this.managed(ref);
    const request = {
      tail: Math.min(opts.tail ?? 100, MAX_TAIL),
      follow: opts.follow ?? false,
      ...(opts.since ? { since: Math.floor(Date.parse(opts.since) / 1000) } : {}),
    };
    if (opts.signal?.aborted) return;

    const output = await call(() => handle.logs(request));
    if (Buffer.isBuffer(output)) {
      const chunks = toIterable([output]);
      for await (const raw of splitLines(details.Config.Tty ? chunks : demux(chunks))) {
        if (raw) yield toLogLine(raw, this.now);
      }
      return;
    }

    const stream = output as NodeJS.ReadableStream & { destroy?: () => void };
    const stop = () => stream.destroy?.();
    opts.signal?.addEventListener("abort", stop, { once: true });
    try {
      const chunks = stream as AsyncIterable<Buffer>;
      for await (const raw of splitLines(details.Config.Tty ? chunks : demux(chunks))) {
        if (raw) yield toLogLine(raw, this.now);
      }
    } catch (error) {
      // Destroying the stream on abort ends the iteration with a premature-close error.
      if (!opts.signal?.aborted) throw mapError(error);
    } finally {
      opts.signal?.removeEventListener("abort", stop);
      stop();
    }
  }

  /** Load, memory and disk of the machine Wickwatch runs on; NTP state is not visible from here. */
  async hostStatus(): Promise<HostStatus> {
    const memTotal = totalmem();
    const fs = await statfsNearest(this.diskPath);
    const diskTotal = fs.blocks * fs.bsize;
    return {
      cpu: Math.min(1, Math.round(((loadavg()[0] ?? 0) / availableParallelism()) * 1000) / 1000),
      memUsed: memTotal - ((await memAvailable()) ?? freemem()),
      memTotal,
      diskUsed: diskTotal - fs.bfree * fs.bsize,
      diskTotal,
    };
  }

  private async managed(ref: string): Promise<{ handle: ContainerHandle; details: ContainerDetails }> {
    const handle = this.client.container(ref);
    const details = await call(() => handle.inspect());
    if (details.Config.Labels?.[this.instanceLabel] === undefined) {
      throw new AdapterError("not_found", `Container ${ref} is not a Wickwatch instance`);
    }
    return { handle, details };
  }
}

function toRuntimeInstance(d: ContainerDetails): RuntimeInstance {
  const status = toStatus(d.State);
  return {
    ref: d.Name.replace(/^\//, ""),
    labels: { ...d.Config.Labels },
    status,
    restartCount: d.RestartCount,
    image: d.Config.Image,
    ...(status === "running" && Date.parse(d.State.StartedAt) > 0
      ? { startedAt: new Date(d.State.StartedAt).toISOString() }
      : {}),
  };
}

export function toStatus(state: ContainerDetails["State"]): InstanceStatus {
  if (state.Restarting || state.Status === "restarting") return "restarting";
  switch (state.Status) {
    case "running":
      return state.Health?.Status === "unhealthy" ? "error" : "running";
    case "created":
    case "paused":
      return "stopped";
    case "exited":
      return state.ExitCode === 0 || STOP_EXIT_CODES.has(state.ExitCode) ? "stopped" : "error";
    case "dead":
      return "error";
    default:
      return "unknown";
  }
}

/** statfs of the path, or of its nearest existing parent (the data directory may not exist yet). */
async function statfsNearest(path: string): Promise<StatsFs> {
  try {
    return await statfs(path);
  } catch (error) {
    const parent = dirname(path);
    if (parent === path) throw error;
    return statfsNearest(parent);
  }
}

/** MemAvailable from /proc/meminfo (Linux); freemem() alone ignores reclaimable cache. */
async function memAvailable(): Promise<number | undefined> {
  try {
    const match = /^MemAvailable:\s+(\d+) kB/m.exec(await readFile("/proc/meminfo", "utf8"));
    return match?.[1] ? Number(match[1]) * 1024 : undefined;
  } catch {
    return undefined;
  }
}

async function* toIterable<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}

function unsupported(): AdapterError {
  return new AdapterError(
    "unsupported",
    "The docker runtime does not create, change or remove instances yet; define them in your compose file",
  );
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapError(error);
  }
}

/** Like call(), but a 304 ("already started/stopped") counts as success. */
async function callIdempotent(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (statusCode(error) !== 304) throw mapError(error);
  }
}

function statusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : undefined;
}

export function mapError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  const status = statusCode(error);
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (status === 404) return new AdapterError("not_found", message, { cause: error });
  if (status === 409) return new AdapterError("invalid_input", message, { cause: error });
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return new AdapterError("timeout", message, { cause: error });
  // 403 comes from docker-socket-proxy when an endpoint is not enabled.
  return new AdapterError("unavailable", message, { cause: error });
}
