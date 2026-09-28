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

/** Adds the broker's platform events (e.g. a lost connection) to every line the runtime reads. */
export function withLogEvents(
  runtime: RuntimeAdapter,
  logEvent: ((text: string) => LogEvent | undefined) | undefined,
): RuntimeAdapter {
  if (!logEvent) return runtime;
  async function* annotate(lines: AsyncIterable<LogLine>): AsyncIterable<LogLine> {
    for await (const line of lines) {
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
    const result = new Map<string, InstanceLogState>();
    for (const { ref } of instances) {
      const state = this.seen.get(ref)?.state;
      if (state && (state.connectionLostSince || state.crashes)) result.set(ref, state);
    }
    return result;
  }

  private async update(instance: RuntimeInstance): Promise<void> {
    if (instance.status !== "running") {
      this.seen.delete(instance.ref);
      return;
    }
    const previous = this.seen.get(instance.ref);
    const known = previous?.startedAt === instance.startedAt ? previous : undefined;
    const since = known ? known.cursor : instance.startedAt;
    let cursor = since;
    // Lines already applied at the cursor; the runtime sends them again.
    let expected = [...(known?.atCursor ?? [])];
    let atCursor: string[] = [];
    const state: InstanceLogState = { ...known?.state };
    try {
      for await (const line of this.runtime.logs(instance.ref, { tail: MAX_LINES, ...(since ? { since } : {}) })) {
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
      return;
    }
    this.seen.set(instance.ref, { startedAt: instance.startedAt, cursor, atCursor: [...atCursor, ...expected], state });
  }
}

function apply(state: InstanceLogState, line: LogLine): void {
  if (line.event === "connection_lost") state.connectionLostSince ??= line.time;
  else if (line.event === "connection_restored") delete state.connectionLostSince;
  else if (line.event === "algo_crashed") {
    state.crashes = { count: (state.crashes?.count ?? 0) + 1, lastAt: line.time, lastText: line.text };
  }
}
