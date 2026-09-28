import type { IsoTime, LogEvent, LogLine, LogOptions, RuntimeAdapter, RuntimeInstance } from "@wickwatch/core";

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
  lostSince?: IsoTime;
}

/**
 * Remembers per running instance whether its log last said that the broker connection is lost.
 * The container keeps running meanwhile, so its status alone does not show it. Each call reads
 * only the lines since the previous one; a new start of the instance begins from scratch.
 */
export class ConnectionTracker {
  private readonly seen = new Map<string, Seen>();

  constructor(private readonly runtime: RuntimeAdapter) {}

  /** When each of these instances lost its connection, for those that are still without one. */
  async lost(instances: RuntimeInstance[]): Promise<Map<string, IsoTime>> {
    await Promise.all(instances.map((instance) => this.update(instance)));
    const result = new Map<string, IsoTime>();
    for (const { ref } of instances) {
      const lostSince = this.seen.get(ref)?.lostSince;
      if (lostSince) result.set(ref, lostSince);
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
    let lostSince = known?.lostSince;
    try {
      // The runtime may round `since` down, so a few lines come twice; replaying them in order is harmless.
      for await (const line of this.runtime.logs(instance.ref, { tail: MAX_LINES, ...(since ? { since } : {}) })) {
        cursor = line.time;
        if (line.event === "connection_lost") lostSince ??= line.time;
        else if (line.event === "connection_restored") lostSince = undefined;
      }
    } catch {
      // Unreadable log: keep what was known.
      return;
    }
    this.seen.set(instance.ref, { startedAt: instance.startedAt, cursor, ...(lostSince ? { lostSince } : {}) });
  }
}
