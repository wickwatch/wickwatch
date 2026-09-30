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
export async function lastLogLine(runtime: RuntimeAdapter, ref: string): Promise<LogLine | undefined> {
  let last: LogLine | undefined;
  try {
    for await (const line of runtime.logs(ref, { tail: 1 })) last = line;
  } catch {
    // A missing log is not worth failing a view for.
  }
  return last;
}

interface Seen {
  startedAt: IsoTime | undefined;
  /** Time of the last line read; the next call reads from here. */
  cursor: IsoTime | undefined;
  /** Texts of the lines read at `cursor`, so the ones the runtime sends again are skipped. */
  atCursor: string[];
  state: InstanceLogState;
}

/**
 * Remembers per running instance what its log says beyond the runtime status: whether the broker
 * connection is lost (the container keeps running meanwhile) and how often the algo threw errors.
 * Each call reads only the lines since the previous one; a new start of the instance begins from scratch.
 */
export class LogTracker {
  private readonly seen = new Map<string, Seen>();

  constructor(private readonly runtime: RuntimeAdapter) {}

  /** The log state of each of these instances that has something to report. */
  async states(instances: RuntimeInstance[]): Promise<Map<string, InstanceLogState>> {
    await Promise.all(instances.map((instance) => this.update(instance)));
    return this.reported(instances);
  }

  /**
   * The log states, as `states` gives them, and the last line of each instance's log. For a running instance that is
   * the last line just read; only where there was none (not running, nothing read, unreadable) it is read separately.
   */
  async read(
    instances: RuntimeInstance[],
  ): Promise<{ states: Map<string, InstanceLogState>; lastLines: Map<string, LogLine> }> {
    const lastLines = new Map<string, LogLine>();
    await Promise.all(
      instances.map(async (instance) => {
        const last = (await this.update(instance)) ?? (await lastLogLine(this.runtime, instance.ref));
        if (last) lastLines.set(instance.ref, last);
      }),
    );
    return { states: this.reported(instances), lastLines };
  }

  private reported(instances: RuntimeInstance[]): Map<string, InstanceLogState> {
    const result = new Map<string, InstanceLogState>();
    for (const { ref } of instances) {
      const state = this.seen.get(ref)?.state;
      if (state && (state.connectionLostSince || state.crashes)) result.set(ref, state);
    }
    return result;
  }

  /** Reads what is new in a running instance's log; returns the last line read. */
  private async update(instance: RuntimeInstance): Promise<LogLine | undefined> {
    if (instance.status !== "running") {
      this.seen.delete(instance.ref);
      return undefined;
    }
    const previous = this.seen.get(instance.ref);
    const known = previous?.startedAt === instance.startedAt ? previous : undefined;
    const since = known ? known.cursor : instance.startedAt;
    let cursor = since;
    // Lines already applied at the cursor; the runtime sends them again.
    let expected = [...(known?.atCursor ?? [])];
    let atCursor: string[] = [];
    let last: LogLine | undefined;
    const state: InstanceLogState = { ...known?.state };
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
        else apply(state, line);
      }
    } catch {
      // Unreadable log: keep what was known.
      return undefined;
    }
    this.seen.set(instance.ref, { startedAt: instance.startedAt, cursor, atCursor: [...atCursor, ...expected], state });
    return last;
  }
}

function apply(state: InstanceLogState, line: LogLine): void {
  if (line.event === "connection_lost") state.connectionLostSince ??= line.time;
  else if (line.event === "connection_restored") delete state.connectionLostSince;
  else if (line.event === "algo_crashed") {
    state.crashes = { count: (state.crashes?.count ?? 0) + 1, lastAt: line.time, lastText: line.text };
  }
}
