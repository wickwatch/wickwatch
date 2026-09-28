import type { LogLine, LogOptions, RuntimeAdapter, RuntimeInstance } from "@wickwatch/core";
import { describe, expect, it } from "vitest";
import { LogTracker, withLogEvents } from "../src/services/log-tracker";

const STARTED = "2026-09-28T16:33:30.000Z";
const line = (time: string, text: string): LogLine => ({ time, text, level: "info" });
const running = (startedAt = STARTED): RuntimeInstance => ({
  ref: "ww-probe",
  labels: {},
  status: "running",
  startedAt,
  restartCount: 0,
});

/** A runtime whose log is `lines`; records the options of every read. */
function fakeRuntime(lines: LogLine[]) {
  const reads: LogOptions[] = [];
  const runtime = {
    id: "fake",
    async *logs(_ref: string, opts: LogOptions = {}) {
      reads.push(opts);
      const since = opts.since ? Math.floor(Date.parse(opts.since) / 1000) * 1000 : 0;
      yield* lines.filter((l) => Date.parse(l.time) >= since);
    },
  } as unknown as RuntimeAdapter;
  return { runtime, reads, lines };
}

const classify = (text: string) =>
  text.startsWith("lost")
    ? "connection_lost"
    : text.startsWith("restored")
      ? "connection_restored"
      : text.startsWith("crash")
        ? "algo_crashed"
        : undefined;

describe("withLogEvents", () => {
  it("adds the broker's events to log lines and raises a lost connection to a warning", async () => {
    const { runtime } = fakeRuntime([
      line("2026-09-28T16:34:50.272Z", "lost"),
      line("2026-09-28T16:35:18.318Z", "restored"),
      line("2026-09-28T16:35:21.356Z", "tick"),
    ]);
    const lines: LogLine[] = [];
    for await (const l of withLogEvents(runtime, classify).logs("ww-probe")) lines.push(l);
    expect(lines.map((l) => [l.event, l.level])).toEqual([
      ["connection_lost", "warn"],
      ["connection_restored", "info"],
      [undefined, "info"],
    ]);
    expect(withLogEvents(runtime, undefined)).toBe(runtime);
  });
});

describe("LogTracker", () => {
  it("reports a lost connection until the log says it is back", async () => {
    const { runtime, reads, lines } = fakeRuntime([line("2026-09-28T16:33:36.000Z", "tick")]);
    const tracker = new LogTracker(withLogEvents(runtime, classify));

    expect(await tracker.states([running()])).toEqual(new Map());
    expect(reads[0]).toMatchObject({ since: STARTED });

    lines.push(line("2026-09-28T16:34:50.272Z", "lost"), line("2026-09-28T16:34:51.374Z", "tick"));
    expect(await tracker.states([running()])).toEqual(
      new Map([["ww-probe", { connectionLostSince: "2026-09-28T16:34:50.272Z" }]]),
    );
    // Only the lines since the last one read.
    expect(reads[1]).toMatchObject({ since: "2026-09-28T16:33:36.000Z" });

    // Still lost: the next read starts after the event, the time it was lost stays.
    lines.push(line("2026-09-28T16:35:01.000Z", "tick"));
    expect(await tracker.states([running()])).toEqual(
      new Map([["ww-probe", { connectionLostSince: "2026-09-28T16:34:50.272Z" }]]),
    );

    lines.push(line("2026-09-28T16:35:18.318Z", "restored"));
    expect(await tracker.states([running()])).toEqual(new Map());
  });

  it("counts crashes once, although the runtime sends lines of the same second again", async () => {
    const { runtime, lines } = fakeRuntime([
      line("2026-09-28T16:39:01.899Z", "crash one"),
      line("2026-09-28T16:39:01.899Z", "tick"),
    ]);
    const tracker = new LogTracker(withLogEvents(runtime, classify));
    const crashes = async () => (await tracker.states([running()])).get("ww-probe")?.crashes;

    expect(await crashes()).toEqual({ count: 1, lastAt: "2026-09-28T16:39:01.899Z", lastText: "crash one" });
    // The same second again, plus a new crash in it.
    lines.push(line("2026-09-28T16:39:01.950Z", "crash two"));
    expect(await crashes()).toMatchObject({ count: 2, lastText: "crash two" });
    expect(await crashes()).toMatchObject({ count: 2 });
    lines.push(line("2026-09-28T16:39:06.902Z", "crash three"));
    expect(await crashes()).toEqual({ count: 3, lastAt: "2026-09-28T16:39:06.902Z", lastText: "crash three" });
    expect(await crashes()).toMatchObject({ count: 3 });
  });

  it("starts from scratch when the instance was restarted or stopped", async () => {
    const { runtime, lines } = fakeRuntime([line("2026-09-28T16:34:50.272Z", "lost")]);
    const tracker = new LogTracker(withLogEvents(runtime, classify));
    expect((await tracker.states([running()])).size).toBe(1);

    expect(await tracker.states([{ ...running(), status: "stopped" }])).toEqual(new Map());

    // A new start only reads its own lines.
    lines.push(line("2026-09-28T17:00:05.000Z", "tick"));
    expect(await tracker.states([running("2026-09-28T17:00:00.000Z")])).toEqual(new Map());
  });

  it("keeps what it knew when the log cannot be read", async () => {
    const { runtime } = fakeRuntime([line("2026-09-28T16:34:50.272Z", "lost")]);
    const annotated = withLogEvents(runtime, classify);
    let broken = false;
    const flaky = new Proxy(annotated, {
      get: (target, key) =>
        key === "logs" && broken
          ? () => {
              throw new Error("gone");
            }
          : (Reflect.get(target, key) as unknown),
    });
    const tracker = new LogTracker(flaky);
    expect((await tracker.states([running()])).size).toBe(1);
    broken = true;
    expect((await tracker.states([running()])).size).toBe(1);
  });
});
