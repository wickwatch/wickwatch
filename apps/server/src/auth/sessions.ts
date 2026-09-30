import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db";
import type { Role } from "../db/schema";

export const SESSION_COOKIE = "ww_session";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(db: Db, userId: number, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db
    .insertInto("sessions")
    .values({
      id: digest(token),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SESSION_MAX_AGE_S * 1000).toISOString(),
      last_seen_at: now.toISOString(),
    })
    .execute();
  return token;
}

/** Resolves a token to its user; expired or idle sessions are deleted. */
export async function findSession(db: Db, token: string, now = new Date()): Promise<SessionUser | undefined> {
  const id = digest(token);
  const row = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select(["users.id", "users.username", "users.role", "sessions.expires_at", "sessions.last_seen_at"])
    .where("sessions.id", "=", id)
    .executeTakeFirst();
  if (!row) return undefined;

  const lastSeen = Date.parse(row.last_seen_at);
  if (Date.parse(row.expires_at) <= now.getTime() || now.getTime() - lastSeen > IDLE_TIMEOUT_MS) {
    await deleteSession(db, token);
    return undefined;
  }
  if (now.getTime() - lastSeen > TOUCH_INTERVAL_MS) {
    await db.updateTable("sessions").set({ last_seen_at: now.toISOString() }).where("id", "=", id).execute();
  }
  return { id: row.id, username: row.username, role: row.role };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.deleteFrom("sessions").where("id", "=", digest(token)).execute();
}

/** Ends every session of a user except the one with `keepToken`, e.g. after a password change. */
export async function deleteOtherSessions(db: Db, userId: number, keepToken: string | undefined): Promise<void> {
  let query = db.deleteFrom("sessions").where("user_id", "=", userId);
  if (keepToken) query = query.where("id", "!=", digest(keepToken));
  await query.execute();
}

export async function deleteExpiredSessions(db: Db, now = new Date()): Promise<void> {
  await db.deleteFrom("sessions").where("expires_at", "<=", now.toISOString()).execute();
}
