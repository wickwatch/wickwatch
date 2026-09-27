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
