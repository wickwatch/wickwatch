import { isAdapterError } from "@wickwatch/core";
import type { Db } from "../db";

export interface AuditEntry {
  action: string;
  target?: string;
  /** Action-specific data; never secrets. */
  details?: Record<string, unknown>;
  userId?: number | undefined;
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
    await audit(db, { ...entry, details: { ok: false, error: isAdapterError(error) ? error.code : "internal" } });
    throw error;
  }
}
