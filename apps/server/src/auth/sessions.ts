import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db";
import type { Role } from "../db/schema";

export const SESSION_COOKIE = "ww_session";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;
/** "Stay logged in": the session lasts this long without an idle timeout. */
export const REMEMBER_MAX_AGE_S = 30 * 24 * 60 * 60;
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const USER_AGENT_MAX = 200;

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
}

/** A session in the user's list. `id` is the stored hash, never the token. */
export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  /** When it ends at the latest: the fixed expiry, or for a session without `remember` the idle timeout if sooner. */
  expiresAt: string;
  remember: boolean;
  userAgent?: string;
  current: boolean;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** The listed id of the session with this token. */
export const sessionId = digest;

/** The end of a session: its fixed expiry, or without `remember` 12 hours after the last request if that is sooner. */
function endsAt(row: { expires_at: string; last_seen_at: string; remember: number }): number {
  const expires = Date.parse(row.expires_at);
  return row.remember ? expires : Math.min(expires, Date.parse(row.last_seen_at) + IDLE_TIMEOUT_MS);
}

/**
 * Creates a session and returns the token for the cookie. Only its hash is stored. A `remember` session lasts
 * REMEMBER_MAX_AGE_S without an idle timeout; otherwise SESSION_MAX_AGE_S, ended after 12 hours without a request.
 */
export async function createSession(
  db: Db,
  userId: number,
  { remember = false, userAgent }: { remember?: boolean; userAgent?: string | undefined } = {},
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const maxAgeS = remember ? REMEMBER_MAX_AGE_S : SESSION_MAX_AGE_S;
  await db
    .insertInto("sessions")
    .values({
      id: digest(token),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + maxAgeS * 1000).toISOString(),
      last_seen_at: now.toISOString(),
      remember: remember ? 1 : 0,
      user_agent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
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
    .select("sessions.remember")
    .where("sessions.id", "=", id)
    .executeTakeFirst();
  if (!row) return undefined;

  if (endsAt(row) <= now.getTime()) {
    await deleteSession(db, token);
    return undefined;
  }
  if (now.getTime() - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    await db.updateTable("sessions").set({ last_seen_at: now.toISOString() }).where("id", "=", id).execute();
  }
  return { id: row.id, username: row.username, role: row.role };
}

/** The user's sessions that are still valid, newest first; `currentToken` marks the one of the request. */
export async function listSessions(
  db: Db,
  userId: number,
  currentToken: string | undefined,
  now = new Date(),
): Promise<SessionInfo[]> {
  const current = currentToken ? digest(currentToken) : undefined;
  const rows = await db
    .selectFrom("sessions")
    .select(["id", "created_at", "last_seen_at", "expires_at", "remember", "user_agent"])
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .execute();
  return rows
    .filter((row) => endsAt(row) > now.getTime())
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: new Date(endsAt(row)).toISOString(),
      remember: row.remember === 1,
      ...(row.user_agent ? { userAgent: row.user_agent } : {}),
      current: row.id === current,
    }));
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.deleteFrom("sessions").where("id", "=", digest(token)).execute();
}

/** Ends one of the user's sessions by its listed id; false if the user has no such session. */
export async function deleteSessionById(db: Db, userId: number, id: string): Promise<boolean> {
  const result = await db.deleteFrom("sessions").where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
  return result.numDeletedRows > 0n;
}

/** Ends every session of a user except the one with `keepToken`, e.g. after a password change. Returns how many. */
export async function deleteOtherSessions(db: Db, userId: number, keepToken: string | undefined): Promise<number> {
  let query = db.deleteFrom("sessions").where("user_id", "=", userId);
  if (keepToken) query = query.where("id", "!=", digest(keepToken));
  return Number((await query.executeTakeFirst()).numDeletedRows);
}

/** Deletes sessions past their fixed expiry. Idle ones go when they are next used or have expired. */
export async function deleteExpiredSessions(db: Db, now = new Date()): Promise<void> {
  await db.deleteFrom("sessions").where("expires_at", "<=", now.toISOString()).execute();
}
