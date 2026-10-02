import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const apiTokens: Migration = {
  // Tokens for scripts and MCP clients (Authorization: Bearer). Only the hash is stored; the token is shown once.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("api_tokens")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("name", "text", (c) => c.notNull())
      // SHA-256 (hex) of the token.
      .addColumn("hash", "text", (c) => c.notNull().unique())
      // The first characters of the token, so it can be recognised in the list.
      .addColumn("prefix", "text", (c) => c.notNull())
      .addColumn("role", "text", (c) => c.notNull().check(sql`role in ('admin', 'viewer')`))
      // The user who created it; requests with the token act as this user, with at most the token's role.
      .addColumn("user_id", "integer", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text")
      .addColumn("last_used_at", "text")
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("api_tokens").execute();
  },
};
