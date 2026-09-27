import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const sessions: Migration = {
  async up(db: Kysely<unknown>) {
    // Last accepted TOTP step per user; a code can be used only once.
    await db.schema.alterTable("users").addColumn("totp_last_counter", "integer").execute();

    await db.schema
      .createTable("sessions")
      // SHA-256 of the session token; the token itself is only in the cookie.
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "integer", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .addColumn("last_seen_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("sessions_user").on("sessions").column("user_id").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("sessions").execute();
    await db.schema.alterTable("users").dropColumn("totp_last_counter").execute();
  },
};
