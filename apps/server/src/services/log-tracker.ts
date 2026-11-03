import type {
  InstanceLogState,
  IsoTime,
  LogEvent,
  LogLine,
  LogOptions,
  RuntimeAdapter,
  RuntimeInstance,
} from "@wickwatch/core";

/** Lines read per instance and call; in a busier log an event in between can be missed. */
const MAX_LINES = 1000;

export interface LogReading {
  logEvent?: ((text: string) => LogEvent | undefined) | undefined;
  redactLog?: ((text: string) => string) | undefined;
}

/**
 * Every line the runtime reads, as the broker sees it: secrets it printed hidden (e.g. a licence key
 * among the start parameters) and platform events added (e.g. a lost connection).
 */
export function withLogEvents(runtime: RuntimeAdapter, { logEvent, redactLog }: LogReading): RuntimeAdapter {
  if (!logEvent && !redactLog) return runtime;
  async function* annotate(lines: AsyncIterable<LogLine>): AsyncIterable<LogLine> {
    for await (const raw of lines) {
      const line = redactLog ? { ...raw, text: redactLog(raw.text) } : raw;
      const event = logEvent?.(line.text);
      if (!event) yield line;
      else if (event === "connection_lost" && line.level !== "error") yield { ...line, event, level: "warn" };
      else yield { ...line, event };
    }
  }
  return new Proxy(runtime, {
    get(target, key) {
      if (key === "logs") return (ref: string, opts?: LogOptions) => annotate(target.logs(ref, opts));
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** The last line of an instance's log; undefined if there is none or it cannot be read. */
async function lastLogLine(runtime: RuntimeAdapter, ref: string): Promise<LogLine | undefined> {
  let last: LogLine | undefined;
  try {
    for await (const line of runtime.logs(ref, { tail: 1 })) last = line;
  } catch {
    // A missing log is not worth failing a view for.
  }
  return last;
}

/** Where a log was read up to, per instance start. */
interface Cursor {
  startedAt: IsoTime | undefined;
  /** Time of the last line read; the next call reads from here. */
  cursor: IsoTime | undefined;
  /** Texts of the lines read at `cursor`, so the ones the runtime sends again are skipped. */
  atCursor: string[];
}

/**
 * Reads per running instance the lines of its log that are new since the previous call; a new start of the instance
 * begins from scratch. An instance that is not running is forgotten.
 */
export class LogFollower {
  private readonly cursors = new Map<string, Cursor>();

  constructor(private readonly runtime: RuntimeAdapter) {}

  /**
   * The new lines and the last line read (also one read before), or "unreadable"; none for a stopped instance. `fresh`:
   * read from the instance's start, as it started again (or was not read before), so what was known about it is gone.
   */
  async read(instance: RuntimeInstance): Promise<{ lines: LogLine[]; last?: LogLine; fresh: boolean } | "unreadable"> {
    if (instance.status !== "running") {
      this.cursors.delete(instance.ref);
      return { lines: [], fresh: true };
    }
    const previous = this.cursors.get(instance.ref);
    const known = previous?.startedAt === instance.startedAt ? previous : undefined;
    const since = known ? known.cursor : instance.startedAt;
    let cursor = since;
    // Lines already read at the cursor; the runtime sends them again.
    let expected = [...(known?.atCursor ?? [])];
    let atCursor: string[] = [];
    let last: LogLine | undefined;
    const lines: LogLine[] = [];
    try {
      for await (const line of this.runtime.logs(instance.ref, { tail: MAX_LINES, ...(since ? { since } : {}) })) {
        last = line;
        // The runtime may round `since` down and send earlier lines again.
        if (cursor && line.time < cursor) continue;
        if (line.time !== cursor) {
          cursor = line.time;
          expected = [];
          atCursor = [];
        }
        atCursor.push(line.text);
        const again = expected.indexOf(line.text);
        if (again >= 0) expected.splice(again, 1);
        else lines.push(line);
      }
    } catch {
      return "unreadable";
    }
    this.cursors.set(instance.ref, { startedAt: instance.startedAt, cursor, atCursor: [...atCursor, ...expected] });
    return { lines, ...(last ? { last } : {}), fresh: !known };
  }
}

/**
 * Remembers per running instance what its log says beyond the runtime status: whether the broker
 * connection is lost (the container keeps running meanwhile) and how often the algo threw errors.
 * Each call reads only the lines since the previous one; a new start of the instance begins from scratch.
 */
export class LogTracker {
  private readonly states = new Map<string, InstanceLogState>();
  private readonly follower: LogFollower;

  constructor(private readonly runtime: RuntimeAdapter) {
    this.follower = new LogFollower(runtime);
  }

  /**
   * The log state of each of these instances that has something to report, and the last line of each instance's log.
   * For a running instance that is the last line just read; only where there was none (not running, nothing new) it
   * is read separately. A log that could not be read just now is not read again.
   */
  async read(
    instances: RuntimeInstance[],
  ): Promise<{ states: Map<string, InstanceLogState>; lastLines: Map<string, LogLine> }> {
    const lastLines = new Map<string, LogLine>();
    await Promise.all(
      instances.map(async (instance) => {
        const read = await this.update(instance);
        if (read === "unreadable") return;
        const last = read ?? (await lastLogLine(this.runtime, instance.ref));
        if (last) lastLines.set(instance.ref, last);
      }),
    );
    return { states: this.reported(instances), lastLines };
  }

  private reported(instances: RuntimeInstance[]): Map<string, InstanceLogState> {
    const result = new Map<string, InstanceLogState>();
    for (const { ref } of instances) {
      const state = this.states.get(ref);
      if (state && (state.connectionLostSince || state.crashes)) result.set(ref, state);
    }
    return result;
  }

  /** Reads what is new in a running instance's log; returns the last line read, if any. */
  private async update(instance: RuntimeInstance): Promise<LogLine | undefined | "unreadable"> {
    const read = await this.follower.read(instance);
    if (instance.status !== "running") {
      this.states.delete(instance.ref);
      return undefined;
    }
    // Unreadable log: keep what was known.
    if (read === "unreadable") return read;
    const state: InstanceLogState = { ...(read.fresh ? {} : this.states.get(instance.ref)) };
    for (const line of read.lines) apply(state, line);
    this.states.set(instance.ref, state);
    return read.last;
  }
}

function apply(state: InstanceLogState, line: LogLine): void {
  if (line.event === "connection_lost") state.connectionLostSince ??= line.time;
  else if (line.event === "connection_restored") delete state.connectionLostSince;
  else if (line.event === "algo_crashed") {
    state.crashes = { count: (state.crashes?.count ?? 0) + 1, lastAt: line.time, lastText: line.text };
  }
}
