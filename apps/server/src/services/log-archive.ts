import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { FastifyBaseLogger } from "fastify";
import type { IsoTime, LogLine, LogOptions, RuntimeAdapter } from "@wickwatch/core";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `1791037500123.jsonl.gz`: when the log was kept, in ms since the epoch; later than every line in it. */
const SUFFIX = ".jsonl.gz";
const keptAt = (name: string) => Number(name.slice(0, name.indexOf(".")));

interface Range {
  since?: IsoTime | undefined;
  before?: IsoTime | undefined;
}

/**
 * The logs of replaced containers, which the runtime loses with them: one gzipped file of LogLines (JSON, one per line)
 * per container, in a folder per instance. The lines are kept as the runtime adapter reads them, so secrets the broker
 * hides in the log are hidden here too.
 */
export class LogArchive {
  constructor(private readonly options: { dir: string; days: number }) {}

  /** Writes these lines as the newest kept log of the instance; returns how many there were (none: no file). */
  async keep(ref: string, lines: AsyncIterable<LogLine>, now = new Date()): Promise<number> {
    const folder = this.folder(ref);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, `${String(now.getTime())}${SUFFIX}`);
    const partial = `${file}.tmp`;
    let count = 0;
    async function* json() {
      for await (const line of lines) {
        count++;
        yield `${JSON.stringify(line)}\n`;
      }
    }
    try {
      await pipeline(Readable.from(json()), createGzip(), createWriteStream(partial, { mode: 0o600 }));
      if (count > 0) await rename(partial, file);
    } finally {
      await rm(partial, { force: true });
    }
    return count;
  }

  /** The kept lines of an instance in the range, oldest first. */
  async *lines(ref: string, { since, before }: Range = {}): AsyncIterable<LogLine> {
    for (const name of await this.files(ref, since)) {
      for await (const line of readFile(join(this.folder(ref), name))) {
        if (since && line.time < since) continue;
        if (before && line.time >= before) return;
        yield line;
      }
    }
  }

  /** The last `count` kept lines of an instance in the range, oldest first; reads only the newest files it needs. */
  async tail(ref: string, count: number, { since, before }: Range = {}): Promise<LogLine[]> {
    let result: LogLine[] = [];
    for (const name of (await this.files(ref, since)).reverse()) {
      const last: LogLine[] = [];
      for await (const line of readFile(join(this.folder(ref), name))) {
        if ((since && line.time < since) || (before && line.time >= before)) continue;
        last.push(line);
        if (last.length > count - result.length) last.shift();
      }
      result = [...last, ...result];
      if (result.length >= count) break;
    }
    return result;
  }

  async has(ref: string): Promise<boolean> {
    return (await this.files(ref)).length > 0;
  }

  /** Deletes every kept log of the instance. */
  async drop(ref: string): Promise<void> {
    await rm(this.folder(ref), { recursive: true, force: true });
  }

  /** Deletes the kept logs older than `days` (and files a crash left half-written); returns how many. */
  async prune(now = new Date()): Promise<number> {
    const before = now.getTime() - this.options.days * DAY_MS;
    let deleted = 0;
    for (const ref of await list(this.options.dir)) {
      const folder = join(this.options.dir, ref);
      const names = await list(folder);
      const old = names.filter((name) => keptAt(name) < before);
      for (const name of old) await rm(join(folder, name), { force: true });
      deleted += old.length;
      if (old.length === names.length) await rm(folder, { recursive: true, force: true });
    }
    return deleted;
  }

  /** A folder name, never a path: the ref reaches the archive unchanged from the runtime and the routes. */
  private folder(ref: string): string {
    if (ref !== basename(ref) || ref.startsWith(".")) throw new Error(`Not a ref: ${ref}`);
    return join(this.options.dir, ref);
  }

  /** The complete files of an instance, oldest first; without those kept before `since`, which hold older lines only. */
  private async files(ref: string, since?: IsoTime): Promise<string[]> {
    const from = since ? Date.parse(since) : 0;
    return (await list(this.folder(ref)))
      .filter((name) => name.endsWith(SUFFIX) && keptAt(name) >= from)
      .sort((a, b) => keptAt(a) - keptAt(b));
  }
}

/** The entries of a folder; none when it does not exist. */
async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function* readFile(path: string): AsyncIterable<LogLine> {
  const source = createReadStream(path);
  const gunzip = createGunzip();
  source.on("error", (error) => gunzip.destroy(error));
  gunzip.setEncoding("utf8");
  let rest = "";
  try {
    for await (const chunk of source.pipe(gunzip) as AsyncIterable<string>) {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop() ?? "";
      for (const part of parts) if (part) yield JSON.parse(part) as LogLine;
    }
  } catch (error) {
    // Deleted by `prune` while being read.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  } finally {
    source.destroy();
  }
  if (rest) yield JSON.parse(rest) as LogLine;
}

/**
 * The runtime with the logs of replaced containers kept: `update` keeps the old container's log before it is removed,
 * `remove` deletes the instance's kept logs. A failure is logged and never fails the action. Reads stay the runtime's
 * own (see logReader); give it the runtime that hides secrets in the log (withLogEvents), so the kept lines are hidden.
 */
export function withLogArchive(
  runtime: RuntimeAdapter,
  archive: LogArchive | undefined,
  log: FastifyBaseLogger,
): RuntimeAdapter {
  if (!archive) return runtime;
  const update: RuntimeAdapter["update"] = (ref, spec, opts) =>
    runtime.update(ref, spec, {
      ...opts,
      beforeRemove: async () => {
        await opts?.beforeRemove?.();
        try {
          await archive.keep(ref, runtime.logs(ref, { tail: "all" }));
        } catch (error) {
          log.warn({ err: error, instance: ref }, "Keeping the log of the replaced container failed");
        }
      },
    });
  const remove = async (ref: string) => {
    await runtime.remove(ref);
    await archive.drop(ref).catch((error: unknown) => {
      log.warn({ err: error, instance: ref }, "Deleting the kept logs failed");
    });
  };
  return new Proxy(runtime, {
    get(target, key) {
      if (key === "update") return update;
      if (key === "remove") return remove;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export type LogReader = (ref: string, opts: LogOptions) => AsyncIterable<LogLine>;

/**
 * An instance's log as people read it (live log, download, MCP): the kept lines of its earlier containers, then the
 * runtime's own. Checks like the instance keeper's read the runtime alone; an old container's lines would mislead them.
 * A numeric `tail` counts both, assuming the runtime sends that many lines when it has them (its cap is the callers').
 */
export function logReader(runtime: RuntimeAdapter, archive: LogArchive | undefined): LogReader {
  if (!archive) return (ref, opts) => runtime.logs(ref, opts);
  return async function* (ref, opts) {
    const { tail = 100, since } = opts;
    if (!(await archive.has(ref))) {
      yield* runtime.logs(ref, opts);
      return;
    }
    if (tail === "all") {
      const current = runtime.logs(ref, opts)[Symbol.asyncIterator]();
      try {
        const first = await current.next();
        yield* archive.lines(ref, { since, before: first.done ? undefined : first.value.time });
        for (let next = first; !next.done; next = await current.next()) yield next.value;
      } finally {
        await current.return?.();
      }
      return;
    }
    const current: LogLine[] = [];
    for await (const line of runtime.logs(ref, { ...opts, follow: false })) current.push(line);
    if (current.length < tail)
      yield* await archive.tail(ref, tail - current.length, { since, before: current[0]?.time });
    // Following reads again: the lines up to now, then the new ones.
    yield* opts.follow ? runtime.logs(ref, opts) : current;
  };
}
