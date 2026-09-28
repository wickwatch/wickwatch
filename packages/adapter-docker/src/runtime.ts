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
  type ToolProcess,
  type ToolSpec,
} from "@wickwatch/core";
import {
  createDockerClient,
  type ContainerDetails,
  type ContainerHandle,
  type CreateRequest,
  type DockerClient,
} from "./client";
import { demux, splitLines, toLogLine } from "./logs";
import { tarFiles } from "./tar";

export interface DockerRuntimeOptions {
  /** e.g. tcp://socket-proxy:2375; defaults to the local socket. */
  dockerHost?: string;
  labelPrefix?: string;
  /** Directory whose file system is reported as disk usage (the data directory). */
  diskPath?: string;
  client?: DockerClient;
  now?: () => Date;
  /** Restart policy of created containers; `on-failure` keeps a bot stopped that stopped itself. */
  restartPolicy?: CreateRequest["restartPolicy"];
  /** Seconds a bot gets to shut down cleanly on stop. */
  stopTimeoutSeconds?: number;
}

/** Container names Docker accepts; the core's instance names are a subset. */
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

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
  private readonly managedLabel: string;
  private readonly toolLabel: string;
  private orphansRemoved: Promise<void> | undefined;
  private readonly diskPath: string;
  private readonly now: () => Date;
  private readonly restartPolicy: CreateRequest["restartPolicy"];
  private readonly stopTimeout: number;

  constructor(options: DockerRuntimeOptions = {}) {
    this.client = options.client ?? createDockerClient(options.dockerHost);
    this.instanceLabel = labelKey(options.labelPrefix ?? DEFAULT_LABEL_PREFIX, "instance");
    this.managedLabel = labelKey(options.labelPrefix ?? DEFAULT_LABEL_PREFIX, "managed");
    this.toolLabel = labelKey(options.labelPrefix ?? DEFAULT_LABEL_PREFIX, "tool");
    this.restartPolicy = options.restartPolicy ?? "on-failure";
    this.stopTimeout = options.stopTimeoutSeconds ?? 30;
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

  async create(spec: InstanceSpec): Promise<RuntimeInstance> {
    this.check(spec);
    await this.ensureImage(spec.image);
    await this.build(spec, spec.name);
    return toRuntimeInstance(await call(() => this.client.container(spec.name).inspect()));
  }

  /**
   * Builds the replacement under a temporary name first, so a failure leaves the old container alone;
   * then swaps them. A running instance is started again with the new spec.
   */
  async update(ref: string, spec: InstanceSpec): Promise<RuntimeInstance> {
    this.check(spec);
    if (spec.name !== ref) throw new AdapterError("invalid_input", "An instance cannot be renamed");
    const { handle, details } = await this.owned(ref);
    const wasRunning = toStatus(details.State) !== "stopped";
    await this.ensureImage(spec.image);
    const next = `${ref}-next-${String(this.now().getTime())}`;
    await this.build(spec, next);
    const replacement = this.client.container(next);
    try {
      await callIdempotent(() => handle.stop());
      await call(() => handle.remove());
    } catch (error) {
      await replacement.remove().catch(() => undefined);
      throw mapError(error);
    }
    await call(() => replacement.rename(ref));
    const created = this.client.container(ref);
    if (wasRunning) await callIdempotent(() => created.start());
    return toRuntimeInstance(await call(() => created.inspect()));
  }

  async remove(ref: string): Promise<void> {
    const { handle } = await this.owned(ref);
    await callIdempotent(() => handle.stop());
    await call(() => handle.remove());
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

  /**
   * A throwaway container with open stdin that removes itself when the tool ends. It carries
   * `<prefix>.tool`, not `<prefix>.instance`, so it never shows up as an instance.
   */
  async runTool(spec: ToolSpec): Promise<ToolProcess> {
    checkPinned(spec.image);
    await this.ensureImage(spec.image);
    // Tools of an earlier run (e.g. shell sessions when Wickwatch was killed) are ended once.
    this.orphansRemoved ??= this.removeOrphans();
    await this.orphansRemoved;

    const id = await call(() =>
      this.client.createTool({ image: spec.image, command: spec.command, labels: { [this.toolLabel]: "true" } }),
    );
    const handle = this.client.container(id);
    let stream: NodeJS.ReadWriteStream;
    let exited: Promise<number>;
    try {
      if (spec.files.length) await handle.putArchive(tarFiles(spec.files), "/");
      stream = await handle.attach();
      exited = handle.wait();
      await handle.start();
    } catch (error) {
      await handle.remove().catch(() => undefined);
      throw mapError(error);
    }

    // Output that arrives before the first listener is kept for it.
    const listeners: ((text: string) => void)[] = [];
    const early: string[] = [];
    const drained = (async () => {
      for await (const chunk of demux(stream as AsyncIterable<Buffer>)) {
        const text = chunk.toString();
        if (listeners.length) for (const listener of listeners) listener(text);
        else early.push(text);
      }
    })().catch(() => undefined);
    const exit = exited.then(
      async (code) => {
        await drained;
        return code;
      },
      () => null,
    );
    return {
      write: (text) => void stream.write(text),
      onOutput: (listener) => {
        listeners.push(listener);
        for (const text of early.splice(0)) listener(text);
      },
      exit,
      kill: () => void handle.kill().catch(() => undefined),
    };
  }

  private async removeOrphans(): Promise<void> {
    const orphans = await call(() => this.client.listByLabel(this.toolLabel)).catch(() => []);
    await Promise.all(
      orphans.map((o) =>
        this.client
          .container(o.Id)
          .kill()
          .catch(() => undefined),
      ),
    );
  }

  private check(spec: InstanceSpec): void {
    if (!CONTAINER_NAME.test(spec.name)) throw new AdapterError("invalid_input", `Invalid instance name ${spec.name}`);
    checkPinned(spec.image);
  }

  private async ensureImage(image: string): Promise<void> {
    if (!(await call(() => this.client.hasImage(image)))) await call(() => this.client.pull(image));
  }

  /** Creates the container and copies the files in; removes it again if that fails. */
  private async build(spec: InstanceSpec, name: string): Promise<void> {
    const labels = { ...spec.labels, [this.instanceLabel]: spec.labels[this.instanceLabel] ?? spec.name };
    labels[this.managedLabel] = "true";
    await call(() =>
      this.client.create({
        name,
        image: spec.image,
        command: spec.command,
        labels,
        restartPolicy: this.restartPolicy,
        stopTimeout: this.stopTimeout,
      }),
    );
    if (!spec.files.length) return;
    const handle = this.client.container(name);
    try {
      await handle.putArchive(tarFiles(spec.files), "/");
    } catch (error) {
      await handle.remove().catch(() => undefined);
      throw mapError(error);
    }
  }

  /** Only containers Wickwatch created may be replaced or removed. */
  private async owned(ref: string): Promise<{ handle: ContainerHandle; details: ContainerDetails }> {
    const found = await this.managed(ref);
    if (found.details.Config.Labels?.[this.managedLabel] !== "true") {
      throw new AdapterError("invalid_input", `Container ${ref} is not managed by Wickwatch`);
    }
    return found;
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

function checkPinned(image: string): void {
  if (!/[:@]/.test(image.split("/").pop() ?? "") || image.endsWith(":latest")) {
    throw new AdapterError("invalid_input", `Image ${image} must be pinned to a version`);
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
