import { errorCode, type AuditPage } from "@wickwatch/core";
import type { Db } from "../db";

export interface AuditEntry {
  action: string;
  target?: string;
  /** Action-specific data; never secrets. */
  details?: Record<string, unknown>;
  userId?: number | undefined;
  /** The API token the user acted through, see `actor()` in plugins/auth.ts. */
  token?: { id: number; name: string } | undefined;
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db
    .insertInto("audit_log")
    .values({
      time: new Date().toISOString(),
      user_id: entry.userId ?? null,
      action: entry.action,
      target: entry.target ?? null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      api_token_id: entry.token?.id ?? null,
      api_token: entry.token?.name ?? null,
    })
    .execute();
}

/**
 * Runs an action and audits how it went: `{ ok: true }` plus `okDetails` of its result, or `{ ok: false, error }` with
 * the adapter's error code (`internal` for any other error), which is thrown again.
 */
export async function auditOutcome<T>(
  db: Db,
  entry: Omit<AuditEntry, "details">,
  fn: () => Promise<T>,
  okDetails?: (result: T) => Record<string, unknown>,
): Promise<T> {
  try {
    const result = await fn();
    await audit(db, { ...entry, details: { ok: true, ...okDetails?.(result) } });
    return result;
  } catch (error) {
    await audit(db, { ...entry, details: { ok: false, error: errorCode(error) } });
    throw error;
  }
}

export const AUDIT_MAX_LIMIT = 200;

export interface AuditQuery {
  /** Exact action or, ending in a dot, a prefix (`instance.`). */
  action?: string | undefined;
  /** Part of the target. */
  target?: string | undefined;
  /** Entries with a smaller id: the next page back. */
  before?: number | undefined;
  /** Entries at or after this time. */
  since?: string | undefined;
  limit?: number | undefined;
}

/** A page of the audit log, newest first. */
export async function readAuditLog(db: Db, query: AuditQuery): Promise<AuditPage> {
  const { action, target, before, since } = query;
  const limit = Math.min(query.limit ?? 100, AUDIT_MAX_LIMIT);
  const rows = await db
    .selectFrom("audit_log")
    .leftJoin("users", "users.id", "audit_log.user_id")
    .select([
      "audit_log.id",
      "audit_log.time",
      "users.username",
      "audit_log.action",
      "audit_log.target",
      "audit_log.details",
      "audit_log.api_token_id",
      "audit_log.api_token",
    ])
    .$if(action !== undefined && action.endsWith("."), (q) => q.where("audit_log.action", "like", `${action ?? ""}%`))
    .$if(action !== undefined && !action.endsWith("."), (q) => q.where("audit_log.action", "=", action ?? ""))
    .$if(Boolean(target), (q) => q.where("audit_log.target", "like", `%${target ?? ""}%`))
    .$if(before !== undefined, (q) => q.where("audit_log.id", "<", before ?? 0))
    .$if(since !== undefined, (q) => q.where("audit_log.time", ">=", new Date(since ?? 0).toISOString()))
    .orderBy("audit_log.id", "desc")
    .limit(limit + 1)
    .execute();
  const actions = await db.selectFrom("audit_log").select("action").distinct().orderBy("action").execute();
  return {
    entries: rows.slice(0, limit).map((r) => {
      let details: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = r.details ? JSON.parse(r.details) : undefined;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed as Record<string, unknown>;
      } catch {
        // An unreadable entry still shows, without details.
      }
      return {
        id: r.id,
        time: r.time,
        ...(r.username ? { user: r.username } : {}),
        ...(r.api_token_id !== null && r.api_token !== null
          ? { token: { id: r.api_token_id, name: r.api_token } }
          : {}),
        action: r.action,
        ...(r.target ? { target: r.target } : {}),
        ...(details ? { details } : {}),
      };
    }),
    more: rows.length > limit,
    actions: actions.map((a) => a.action),
  };
}
