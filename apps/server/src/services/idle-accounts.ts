import { isActiveInstance, readLabels, type BrokerAdapter, type RuntimeAdapter } from "@wickwatch/core";

/**
 * How long the accounts with a bot are kept: the poller, the loss guard and the overview run on their own timers,
 * so a shorter time would ask the runtime for nearly every query. Actions of wickwatch drop it at once (`forget`).
 */
const BUSY_TTL_MS = 30_000;

interface Kept {
  at: number;
  value: unknown;
}

export interface IdleAccountsOptions {
  broker: BrokerAdapter;
  runtime: RuntimeAdapter;
  labelPrefix: string;
  /** How long the answers for an idle account are reused before the broker is asked again. */
  refreshMs: number;
  now?: () => number;
}

/**
 * Asks the broker less about idle accounts: no instance that is not stopped, and no open position or pending order at
 * the last answer. Their figures can only change by a trade by hand, so the answers are reused for `refreshMs`. The
 * poller, the loss guard and the overview then send no commands for that long, and the adapter can close the
 * account's session (the cTrader CLI keeps one per account) instead of keeping it alive with a query a minute.
 *
 * A trade by hand on an idle account shows within `refreshMs`; afterwards the account is no longer idle. Starting an
 * instance or any other action of wickwatch calls `forget`, so the next query asks the broker.
 */
export class IdleAccounts {
  readonly broker: BrokerAdapter;
  /** Answers by account, then by query: `stats`, `positions`, `pendingOrders`, `deals <from>`. */
  private known = new Map<string, Map<string, Kept>>();
  /** Bumped by `forget`: an answer to a query started before it is not kept. */
  private generation = 0;
  private busy: { at: number; accounts: Promise<Set<string> | undefined> } | undefined;
  private readonly hasPendingOrders: boolean;
  private readonly now: () => number;

  constructor(private readonly options: IdleAccountsOptions) {
    this.now = options.now ?? Date.now;
    const target = options.broker;
    this.hasPendingOrders = target.capabilities().pendingOrders;
    const wrapped: Pick<BrokerAdapter, "stats" | "positions" | "pendingOrders" | "deals"> = {
      stats: (c, account) => this.keep(account, "stats", () => target.stats(c, account)),
      positions: (c, account) => this.keep(account, "positions", () => target.positions(c, account)),
      pendingOrders: (c, account) => this.keep(account, "pendingOrders", () => target.pendingOrders(c, account)),
      // By the start of the range: the poller, the loss guard and the overview each ask from their own day.
      deals: async (c, account, from, to) => {
        const deals = await this.keep(account, `deals ${from}`, () => target.deals(c, account, from, to));
        const until = Date.parse(to);
        return deals.filter((deal) => Date.parse(deal.time) <= until);
      },
    };
    this.broker = new Proxy(target, {
      get(object, key) {
        if (typeof key === "string" && Object.hasOwn(wrapped, key)) return wrapped[key as keyof typeof wrapped];
        const value: unknown = Reflect.get(object, key);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(object) : value;
      },
    });
  }

  /** Drops every kept answer, after something changed (an instance started, a position closed). */
  forget(): void {
    this.known.clear();
    this.busy = undefined;
    this.generation += 1;
  }

  /** The kept answer while the account is idle, else the broker's, kept for later. */
  private async keep<T>(account: string, query: string, ask: () => Promise<T>): Promise<T> {
    const now = this.now();
    const kept = this.known.get(account)?.get(query);
    if (kept && this.fresh(kept, now) && (await this.idle(account, now))) return kept.value as T;
    const generation = this.generation;
    const value = await ask();
    if (generation === this.generation) {
      let answers = this.known.get(account);
      if (!answers) this.known.set(account, (answers = new Map<string, Kept>()));
      for (const [old, entry] of answers) if (!this.fresh(entry, now)) answers.delete(old);
      answers.set(query, { at: now, value });
    }
    return value;
  }

  private fresh(kept: Kept, now: number): boolean {
    return now - kept.at <= this.options.refreshMs;
  }

  /** No open position or pending order at the last answers, both recent, and no bot on the account. */
  private async idle(account: string, now: number): Promise<boolean> {
    const answers = this.known.get(account);
    const empty = (query: string) => {
      const kept = answers?.get(query);
      return kept !== undefined && this.fresh(kept, now) && (kept.value as unknown[]).length === 0;
    };
    if (!empty("positions") || (this.hasPendingOrders && !empty("pendingOrders"))) return false;
    const busy = await this.busyAccounts(now);
    return busy !== undefined && !busy.has(account);
  }

  /**
   * The accounts with an instance that may trade; undefined (no account idle) when the runtime cannot be asked or
   * runs an instance that names no account.
   */
  private busyAccounts(now: number): Promise<Set<string> | undefined> {
    if (this.busy && now - this.busy.at <= BUSY_TTL_MS) return this.busy.accounts;
    const { runtime, labelPrefix } = this.options;
    const accounts = runtime.list().then(
      (instances) => {
        const busy = new Set<string>();
        for (const instance of instances.filter(isActiveInstance)) {
          const { account } = readLabels(labelPrefix, instance.labels);
          if (account === undefined) return undefined;
          busy.add(account);
        }
        return busy;
      },
      () => undefined,
    );
    this.busy = { at: now, accounts };
    return accounts;
  }
}
