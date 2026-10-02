import type { InstanceSummary, MarketHours } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountEntry } from "../accounts";
import type { Adapters } from "../adapters";

const HOUR_MS = 60 * 60 * 1000;
/** Schedules change rarely (e.g. with summer time); once a day is enough, spread over an hour so they do not expire together. */
const REFRESH_MS = 24 * HOUR_MS;
/** After a failed query (broker down, unknown symbol) the next try waits this long. */
const RETRY_MS = HOUR_MS;

interface Entry {
  hours?: MarketHours;
  /** When to ask the broker again; set ahead while a query runs, so it is asked only once. */
  due: number;
}

/**
 * The trading hours of the symbols instances run on, by account and symbol. Broker commands run one at a time per
 * account, so the overview never waits for them: `attach` adds what is known and asks for the rest in the background,
 * one symbol after the other per account, so positions and the emergency stop on the same session are not held up.
 */
export class MarketHoursCache {
  private readonly entries = new Map<string, Entry>();
  /** The last query asked per account; the next one waits for it. */
  private readonly queues = new Map<number, Promise<void>>();

  constructor(
    private readonly options: { adapters: Adapters; log: FastifyBaseLogger; now?: () => number; jitter?: () => number },
  ) {}

  /** The instances with the hours of their symbol, where known; `accounts` are the ones the caller has at hand. */
  attach<T extends InstanceSummary>(instances: T[], accounts: AccountEntry[]): T[] {
    if (!this.options.adapters.broker.marketHours) return instances;
    const byNumber = new Map(accounts.map((a) => [a.number, a]));
    return instances.map((instance) => {
      const entry = instance.account === undefined ? undefined : byNumber.get(instance.account);
      if (!entry || instance.symbol === undefined) return instance;
      const hours = this.peek(entry, instance.symbol);
      return hours ? { ...instance, marketHours: hours } : instance;
    });
  }

  /** Resolves once the queries asked for so far are done; for tests. */
  async settled(): Promise<void> {
    await Promise.all(this.queues.values());
  }

  private peek(entry: AccountEntry, symbol: string): MarketHours | undefined {
    const key = `${String(entry.id)}\u0000${symbol}`;
    const cached = this.entries.get(key);
    if (!cached || cached.due <= this.now()) {
      this.entries.set(key, { ...(cached?.hours ? { hours: cached.hours } : {}), due: this.now() + RETRY_MS });
      this.ask(key, entry, symbol);
    }
    return cached?.hours;
  }

  /** Old hours stay until new ones arrive: a schedule is still right after a failed query. */
  private ask(key: string, entry: AccountEntry, symbol: string): void {
    const { adapters, log } = this.options;
    const query = async () => {
      try {
        const hours = await adapters.broker.marketHours?.(await entry.credentials(), entry.number, symbol);
        if (hours) this.entries.set(key, { hours, due: this.now() + REFRESH_MS + this.jitter() });
      } catch (error) {
        log.warn({ err: error, account: entry.number, symbol }, "Market hours unavailable");
      }
    };
    this.queues.set(entry.id, (this.queues.get(entry.id) ?? Promise.resolve()).then(query));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private jitter(): number {
    return this.options.jitter?.() ?? Math.random() * HOUR_MS;
  }
}
