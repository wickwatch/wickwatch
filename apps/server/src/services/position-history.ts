import type { Credentials, Position, PositionChange } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { findAccountId, type AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";

/** What is compared, in the order changes of one load are listed. */
const FIELDS = ["volume", "entry", "sl", "tp"] as const satisfies readonly PositionChange["field"][];

export interface PositionHistoryOptions {
  db: Db;
  accounts: AccountDirectory;
  log: FastifyBaseLogger;
  now?: () => Date;
}

/**
 * Remembers volume, entry, stop loss and take profit of open positions and notes when one changed (a moved or
 * trailed stop, a partial close, volume added). The broker tells only the current values, so wickwatch compares
 * every positions answer it gets anyway (withPositionHistory; the alert check loads the overview every minute): no
 * broker call of its own. A change is dated when it was noticed; several between two answers show as one.
 */
export class PositionHistory {
  /** Per account number, so two answers at the same time do not both note the same change. */
  private readonly queue = new Map<string, Promise<void>>();
  private readonly now: () => Date;

  constructor(private readonly options: PositionHistoryOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Compares the positions the broker just named with what was seen last. Never fails: errors are logged. */
  observe(account: string, positions: Position[]): Promise<void> {
    const at = this.now().toISOString();
    const run = (this.queue.get(account) ?? Promise.resolve()).then(() =>
      this.record(account, positions, at).catch((error: unknown) => {
        this.options.log.warn({ err: error, account }, "Recording position changes failed");
      }),
    );
    this.queue.set(account, run);
    void run.then(() => {
      if (this.queue.get(account) === run) this.queue.delete(account);
    });
    return run;
  }

  /** The changes of one position, oldest first; empty if it never changed or wickwatch never saw it open. */
  async changes(accountId: number, positionId: string): Promise<PositionChange[]> {
    const rows = await this.options.db
      .selectFrom("position_history")
      .select([...FIELDS, "at"])
      .where("account_id", "=", accountId)
      .where("position_id", "=", positionId)
      .orderBy("id")
      .execute();
    return rows.flatMap((row, index) => {
      const before = rows[index - 1];
      if (!before) return [];
      return FIELDS.filter((field) => row[field] !== before[field]).map((field) => {
        const from = before[field];
        const to = row[field];
        return { at: row.at, field, ...(from !== null ? { from } : {}), ...(to !== null ? { to } : {}) };
      });
    });
  }

  private async record(account: string, positions: Position[], at: string): Promise<void> {
    if (!positions.length) return;
    const { db, accounts } = this.options;
    const accountId = await findAccountId(accounts, account);
    // An account wickwatch does not store, e.g. one just being added.
    if (accountId === undefined) return;
    // The last row of each position only: a trailed stop adds a row per answer.
    const rows = await db
      .selectFrom("position_history")
      .select(["position_id", ...FIELDS])
      .where("id", "in", (eb) =>
        eb
          .selectFrom("position_history")
          .select((sub) => sub.fn.max("id").as("id"))
          .where("account_id", "=", accountId)
          .where(
            "position_id",
            "in",
            positions.map((p) => p.id),
          )
          .groupBy("position_id"),
      )
      .execute();
    const last = new Map(rows.map((row) => [row.position_id, row]));
    const changed = positions.flatMap((p) => {
      const seen = last.get(p.id);
      const now = { volume: p.volume, entry: p.entry, sl: p.sl ?? null, tp: p.tp ?? null };
      if (seen && FIELDS.every((field) => seen[field] === now[field])) return [];
      return [{ account_id: accountId, position_id: p.id, ...now, at }];
    });
    if (changed.length) await db.insertInto("position_history").values(changed).execute();
  }
}

/**
 * The adapters with every positions answer of the broker passed to `history`, whoever asked (the overview, an
 * instance page, an MCP tool), so no caller has to think of it.
 */
export function withPositionHistory(adapters: Adapters, history: PositionHistory): Adapters {
  const broker = new Proxy(adapters.broker, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (key !== "positions") return (value as (...args: unknown[]) => unknown).bind(target);
      return async (c: Credentials, account: string) => {
        const positions = await target.positions(c, account);
        await history.observe(account, positions);
        return positions;
      };
    },
  });
  return { ...adapters, broker };
}
