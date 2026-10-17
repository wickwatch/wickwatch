import type { Credentials, Position, PositionChange, PositionLevels } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { findAccountId, type AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";

/** What is compared, in the order changes of one load are listed. */
const FIELDS = ["volume", "entry", "sl", "tp"] as const satisfies readonly PositionChange["field"][];
/**
 * A position first seen later than this after its opening may have had its stop moved before: its first stop seen
 * is no initial stop. Loads come about once a minute; a few more cover a restart.
 */
const WATCHED_FROM_OPENING_MS = 5 * 60_000;

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
  private readonly queue = new Map<string, Promise<unknown>>();
  private readonly now: () => Date;

  constructor(private readonly options: PositionHistoryOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Compares the positions the broker just named with what was seen last. Answers, for those the broker names no
   * initial stop for, the first stop loss seen on them (by position id), the base for their R: only for positions seen
   * from their opening on, and missing while none was ever set. Never fails: errors are logged, and the stops are
   * then unknown.
   */
  observe(account: string, positions: Position[]): Promise<Map<string, number>> {
    const at = this.now().toISOString();
    const run = (this.queue.get(account) ?? Promise.resolve()).then(() =>
      this.record(account, positions, at).catch((error: unknown) => {
        this.options.log.warn({ err: error, account }, "Recording position changes failed");
        return new Map<string, number>();
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
    const rows = await this.rows(accountId, positionId);
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

  /**
   * Stop loss and take profit of one position over its life, oldest first: from when wickwatch first saw it, then at
   * every change of either. Empty if wickwatch never saw it open.
   */
  async levels(accountId: number, positionId: string): Promise<PositionLevels[]> {
    const rows = await this.rows(accountId, positionId);
    return rows
      .filter((row, index) => index === 0 || row.sl !== rows[index - 1]?.sl || row.tp !== rows[index - 1]?.tp)
      .map(({ at, sl, tp }) => ({ at, ...(sl !== null ? { sl } : {}), ...(tp !== null ? { tp } : {}) }));
  }

  /** What was noted on one position, oldest first: one row per answer that differed from the one before. */
  private rows(accountId: number, positionId: string) {
    return this.options.db
      .selectFrom("position_history")
      .select([...FIELDS, "at"])
      .where("account_id", "=", accountId)
      .where("position_id", "=", positionId)
      .orderBy("id")
      .execute();
  }

  private async record(account: string, positions: Position[], at: string): Promise<Map<string, number>> {
    if (!positions.length) return new Map();
    const { db, accounts } = this.options;
    const accountId = await findAccountId(accounts, account);
    // An account wickwatch does not store, e.g. one just being added.
    if (accountId === undefined) return new Map();
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
    const unknown = positions.filter((p) => p.initialStopLoss === undefined);
    return unknown.length ? this.firstStops(accountId, unknown) : new Map();
  }

  /**
   * The first row of each position (when it was first seen) and its first row with a stop: a stop set only right
   * after the opening still counts as the initial one.
   */
  private async firstStops(accountId: number, positions: Position[]): Promise<Map<string, number>> {
    const rows = await this.options.db
      .selectFrom("position_history")
      .select(["position_id", "sl", "at"])
      .where((eb) => {
        const first = eb
          .selectFrom("position_history")
          .select((sub) => sub.fn.min("id").as("id"))
          .where("account_id", "=", accountId)
          .where(
            "position_id",
            "in",
            positions.map((p) => p.id),
          )
          .groupBy("position_id");
        return eb.or([eb("id", "in", first), eb("id", "in", first.where("sl", "is not", null))]);
      })
      .orderBy("id")
      .execute();
    const seenAt = new Map<string, string>();
    const stops = new Map<string, number>();
    for (const row of rows) {
      if (!seenAt.has(row.position_id)) seenAt.set(row.position_id, row.at);
      if (row.sl !== null && !stops.has(row.position_id)) stops.set(row.position_id, row.sl);
    }
    const watched = (p: Position) =>
      Date.parse(seenAt.get(p.id) ?? "") - Date.parse(p.openedAt) <= WATCHED_FROM_OPENING_MS;
    return new Map(
      positions.flatMap((p) => (watched(p) && stops.has(p.id) ? [[p.id, stops.get(p.id) as number]] : [])),
    );
  }
}

/**
 * The adapters with every positions answer of the broker passed to `history`, whoever asked (the overview, an
 * instance page, an MCP tool), so no caller has to think of it. Positions the broker names no initial stop for get
 * the first one wickwatch saw.
 */
export function withPositionHistory(adapters: Adapters, history: PositionHistory): Adapters {
  const broker = new Proxy(adapters.broker, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (key !== "positions") return (value as (...args: unknown[]) => unknown).bind(target);
      return async (c: Credentials, account: string): Promise<Position[]> => {
        const positions = await target.positions(c, account);
        const stops = await history.observe(account, positions);
        return positions.map((p) => {
          const initialStopLoss = p.initialStopLoss ?? stops.get(p.id);
          return initialStopLoss === undefined ? p : { ...p, initialStopLoss };
        });
      };
    },
  });
  return { ...adapters, broker };
}
