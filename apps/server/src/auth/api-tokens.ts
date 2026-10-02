import { createHash, randomBytes } from "node:crypto";
import type { ApiToken, CreatedApiToken } from "@wickwatch/core";
import type { Db } from "../db";
import type { Role } from "../db/schema";
import type { SessionUser } from "./sessions";

/** Marks wickwatch tokens, so secret scanners and people recognise them. */
export const API_TOKEN_PREFIX = "ww_";
const SHOWN_CHARS = API_TOKEN_PREFIX.length + 6;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token's role, but never more than its user has now (an admin demoted to viewer keeps only viewer tokens). */
const effectiveRole = (token: Role, user: Role): Role => (token === "admin" && user === "admin" ? "admin" : "viewer");

export interface NewApiToken {
  name: string;
  role: Role;
  userId: number;
  /** Omitted: does not expire. */
  expiresInDays?: number | undefined;
}

/** Creates a token and returns it with the token itself, which only its hash is stored of. */
export async function createApiToken(db: Db, input: NewApiToken, now = new Date()): Promise<CreatedApiToken> {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt =
    input.expiresInDays === undefined ? null : new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString();
  const { id } = await db
    .insertInto("api_tokens")
    .values({
      name: input.name,
      hash: digest(token),
      prefix: token.slice(0, SHOWN_CHARS),
      role: input.role,
      user_id: input.userId,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      last_used_at: null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const created = (await listApiTokens(db, now)).find((t) => t.id === id);
  if (!created) throw new Error("API token vanished after insert");
  return { ...created, token };
}

/** All tokens, newest first; expired ones stay listed until they are deleted. */
export async function listApiTokens(db: Db, now = new Date()): Promise<ApiToken[]> {
  const rows = await db
    .selectFrom("api_tokens")
    .innerJoin("users", "users.id", "api_tokens.user_id")
    .select([
      "api_tokens.id",
      "api_tokens.name",
      "api_tokens.prefix",
      "api_tokens.role",
      "users.username",
      "api_tokens.created_at",
      "api_tokens.expires_at",
      "api_tokens.last_used_at",
    ])
    .orderBy("api_tokens.id", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    role: r.role,
    user: r.username,
    createdAt: r.created_at,
    ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
    expired: r.expires_at !== null && Date.parse(r.expires_at) <= now.getTime(),
    ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
  }));
}

export interface TokenLogin {
  user: SessionUser;
  /** For the audit log: which token the user acted through. */
  token: { id: number; name: string };
}

/** Resolves a bearer token to the user it acts as; unknown and expired tokens give undefined. */
export async function findApiToken(db: Db, token: string, now = new Date()): Promise<TokenLogin | undefined> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return undefined;
  const row = await db
    .selectFrom("api_tokens")
    .innerJoin("users", "users.id", "api_tokens.user_id")
    .select([
      "api_tokens.id as tokenId",
      "api_tokens.name as tokenName",
      "api_tokens.role as tokenRole",
      "api_tokens.expires_at",
      "api_tokens.last_used_at",
      "users.id",
      "users.username",
      "users.role",
    ])
    .where("api_tokens.hash", "=", digest(token))
    .executeTakeFirst();
  if (!row) return undefined;
  if (row.expires_at !== null && Date.parse(row.expires_at) <= now.getTime()) return undefined;
  if (!row.last_used_at || now.getTime() - Date.parse(row.last_used_at) > TOUCH_INTERVAL_MS) {
    await db.updateTable("api_tokens").set({ last_used_at: now.toISOString() }).where("id", "=", row.tokenId).execute();
  }
  return {
    user: { id: row.id, username: row.username, role: effectiveRole(row.tokenRole, row.role) },
    token: { id: row.tokenId, name: row.tokenName },
  };
}

/** How many tokens a user created. */
export async function countApiTokens(db: Db, userId: number): Promise<number> {
  const row = await db
    .selectFrom("api_tokens")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  return row.n;
}

/** Deletes all tokens of a user, e.g. with a password change; returns what was deleted, for the audit log. */
export async function deleteUserApiTokens(db: Db, userId: number): Promise<{ id: number; name: string }[]> {
  return db.deleteFrom("api_tokens").where("user_id", "=", userId).returning(["id", "name"]).execute();
}

/** Deletes a token; returns its name, or undefined when there was none. */
export async function deleteApiToken(db: Db, id: number): Promise<string | undefined> {
  const row = await db.deleteFrom("api_tokens").where("id", "=", id).returning("name").executeTakeFirst();
  return row?.name;
}
