import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceSpec, LogLine, LogOptions, RuntimeAdapter, UpdateOptions } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { LogArchive, logReader, searchLog, withLogArchive } from "../src/services/log-archive";

const line = (minute: number, text = `line ${String(minute)}`): LogLine => ({
  time: `2026-10-03T10:${String(minute).padStart(2, "0")}:00.000Z`,
  text,
  level: "info",
});
const at = (iso: string) => new Date(iso);

async function* from(lines: LogLine[]): AsyncIterable<LogLine> {
  yield* lines;
}

async function all(lines: AsyncIterable<LogLine>): Promise<string[]> {
  const texts: string[] = [];
  for await (const l of lines) texts.push(l.text);
  return texts;
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "wickwatch-logs-"));
  return { dir, archive: new LogArchive({ dir, days: 7 }) };
}

/** A runtime whose log is `lines`, `followed` arriving after them; applies `since` and a numeric `tail`. */
function fakeRuntime(lines: LogLine[], followed: LogLine[] = []) {
  const reads: LogOptions[] = [];
  const calls: string[] = [];
  const runtime = {
    id: "fake",
    async *logs(_ref: string, opts: LogOptions = {}) {
      reads.push(opts);
      const matching = lines.filter((l) => l.time >= (opts.since ?? ""));
      yield* opts.tail === "all" ? matching : matching.slice(-(opts.tail ?? 100));
      if (opts.follow) yield* followed;
    },
    async update(_ref: string, _spec: InstanceSpec, opts?: UpdateOptions) {
      calls.push("update");
      await opts?.beforeRemove?.();
      return { ref: "bot-a" };
    },
    async remove() {
      calls.push("remove");
    },
  } as unknown as RuntimeAdapter;
  return { runtime, reads, calls };
}

describe("LogArchive", () => {
  it("keeps logs readable only by the owner and reads them back oldest first", async () => {
    const { dir, archive } = setup();
    expect(await archive.keep("bot-a", from([line(1), line(2)]), at("2026-10-03T12:00:00.000Z"))).toBe(2);
    await archive.keep("bot-a", from([line(3)]), at("2026-10-03T13:00:00.000Z"));
    expect(await all(archive.lines("bot-a"))).toEqual(["line 1", "line 2", "line 3"]);
    expect(await all(archive.lines("bot-a", { since: line(2).time, before: line(3).time }))).toEqual(["line 2"]);

    const files = readdirSync(join(dir, "bot-a"));
    expect(files.sort()).toEqual([
      `${String(Date.parse("2026-10-03T12:00:00.000Z"))}.jsonl.gz`,
      `${String(Date.parse("2026-10-03T13:00:00.000Z"))}.jsonl.gz`,
    ]);
    expect(statSync(join(dir, "bot-a", files[0] ?? "")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "bot-a")).mode & 0o777).toBe(0o700);
  });

  it("takes a tail from the newest files and skips files kept before `since`", async () => {
    const { archive } = setup();
    await archive.keep("bot-a", from([line(1), line(2)]), at("2026-10-03T10:02:30.000Z"));
    await archive.keep("bot-a", from([line(3), line(4)]), at("2026-10-03T10:04:30.000Z"));
    const texts = async (lines: Promise<LogLine[]>) => (await lines).map((l) => l.text);
    expect(await texts(archive.tail("bot-a", 3))).toEqual(["line 2", "line 3", "line 4"]);
    expect(await texts(archive.tail("bot-a", 5, { before: line(4).time }))).toEqual(["line 1", "line 2", "line 3"]);
    expect(await texts(archive.tail("bot-a", 5, { since: line(3).time }))).toEqual(["line 3", "line 4"]);
  });

  it("writes no file for an empty log and knows nothing of other instances", async () => {
    const { archive } = setup();
    expect(await archive.keep("bot-a", from([]))).toBe(0);
    expect(await archive.has("bot-a")).toBe(false);
    expect(await all(archive.lines("bot-b"))).toEqual([]);
  });

  it("refuses refs that are not a plain folder name", async () => {
    const { archive } = setup();
    await expect(archive.keep("../escape", from([line(1)]))).rejects.toThrow(/Not a ref/);
    await expect(archive.drop("a/b")).rejects.toThrow(/Not a ref/);
    await expect(archive.has("..")).rejects.toThrow(/Not a ref/);
  });

  it("deletes logs older than the retention, half-written files and then empty folders", async () => {
    const { dir, archive } = setup();
    const old = at("2026-09-20T12:00:00.000Z");
    await archive.keep("bot-old", from([line(1)]), old);
    await archive.keep("bot-both", from([line(2, "old")]), old);
    writeFileSync(join(dir, "bot-both", `${String(old.getTime() + 1)}.jsonl.gz.tmp`), "");
    await archive.keep("bot-both", from([line(3, "new")]), at("2026-10-01T12:00:00.000Z"));

    expect(await archive.prune(at("2026-10-03T12:00:00.000Z"))).toBe(3);
    expect(readdirSync(dir)).toEqual(["bot-both"]);
    expect(await all(archive.lines("bot-both"))).toEqual(["new"]);
  });
});

describe("withLogArchive", () => {
  const logger = () => {
    const warn = vi.fn();
    return { warn, log: { warn } as unknown as FastifyBaseLogger };
  };

  it("keeps the old container's whole log before the update removes it and drops it with the instance", async () => {
    const { archive } = setup();
    const { runtime, reads, calls } = fakeRuntime([line(1), line(2)]);
    const wrapped = withLogArchive(runtime, archive, logger().log);
    await wrapped.update("bot-a", {} as InstanceSpec);
    expect(reads).toEqual([{ tail: "all" }]);
    expect(await all(archive.lines("bot-a"))).toEqual(["line 1", "line 2"]);

    await wrapped.remove("bot-a");
    expect(calls).toEqual(["update", "remove"]);
    expect(await archive.has("bot-a")).toBe(false);
    expect(withLogArchive(runtime, undefined, logger().log)).toBe(runtime);
  });

  it("logs a failure instead of failing the update", async () => {
    const { archive } = setup();
    const { runtime } = fakeRuntime([]);
    runtime.logs = async function* () {
      yield* [];
      throw new Error("daemon gone");
    };
    const { warn, log } = logger();
    await expect(withLogArchive(runtime, archive, log).update("bot-a", {} as InstanceSpec)).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(await archive.has("bot-a")).toBe(false);
  });
});

describe("logReader", () => {
  it("is the runtime's log alone without kept lines", async () => {
    const { runtime } = fakeRuntime([line(5)]);
    expect(await all(logReader(runtime, undefined)("bot-a", { tail: 10 }))).toEqual(["line 5"]);
    const { archive } = setup();
    expect(await all(logReader(runtime, archive)("bot-a", { tail: 10 }))).toEqual(["line 5"]);
  });

  it("fills a tail with the newest kept lines before the container's own", async () => {
    const { archive } = setup();
    await archive.keep("bot-a", from([line(1), line(2), line(3)]));
    const read = logReader(fakeRuntime([line(4), line(5)]).runtime, archive);
    expect(await all(read("bot-a", { tail: 4 }))).toEqual(["line 2", "line 3", "line 4", "line 5"]);
    expect(await all(read("bot-a", { tail: 2 }))).toEqual(["line 4", "line 5"]);
  });

  it("follows the container after the kept lines", async () => {
    const { archive } = setup();
    await archive.keep("bot-a", from([line(1)]));
    const { runtime, reads } = fakeRuntime([line(4)], [line(6)]);
    expect(await all(logReader(runtime, archive)("bot-a", { tail: 5, follow: true }))).toEqual([
      "line 1",
      "line 4",
      "line 6",
    ]);
    expect(reads.at(-1)).toMatchObject({ tail: 5, follow: true });
  });

  it("sends everything since `since`, kept lines first, without lines the container has itself", async () => {
    const { archive } = setup();
    await archive.keep("bot-a", from([line(1), line(2), line(4, "kept 4")]));
    const read = logReader(fakeRuntime([line(4), line(5)]).runtime, archive);
    expect(await all(read("bot-a", { tail: "all", since: line(2).time }))).toEqual(["line 2", "line 4", "line 5"]);
    const readEmpty = logReader(fakeRuntime([]).runtime, archive);
    expect(await all(readEmpty("bot-a", { tail: "all" }))).toEqual(["line 1", "line 2", "kept 4"]);
  });
});

describe("searchLog", () => {
  it("searches kept and current lines, case ignored, keeping the newest matches", async () => {
    const { archive } = setup();
    await archive.keep("bot-a", from([line(1, "Order FILLED"), line(2, "heartbeat")]));
    const current = [
      line(4, "order filled again"),
      { ...line(5, "Order rejected"), level: "error" as const },
      { ...line(6, "setup"), setup: { name: "orb" } },
    ];
    const read = logReader(fakeRuntime(current).runtime, archive);
    const texts = (r: { lines: LogLine[] }) => r.lines.map((l) => l.text);

    expect(texts(await searchLog(read, "bot-a", { contains: "ORDER" }))).toEqual([
      "Order FILLED",
      "order filled again",
      "Order rejected",
    ]);
    expect(await searchLog(read, "bot-a", { contains: "order", limit: 2 })).toMatchObject({ truncated: true });
    expect(texts(await searchLog(read, "bot-a", { contains: "order", limit: 2 }))).toEqual([
      "order filled again",
      "Order rejected",
    ]);
    expect(texts(await searchLog(read, "bot-a", { contains: "order", filter: "problems" }))).toEqual([
      "Order rejected",
    ]);
    expect(texts(await searchLog(read, "bot-a", { filter: "setups" }))).toEqual(["setup"]);
    expect(await searchLog(read, "bot-a", { contains: "nothing" })).toEqual({ lines: [], truncated: false });
  });
});
