import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Migrations take Kysely<unknown>: they must not depend on the current table types.
export const initial: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("users")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("username", "text", (c) => c.notNull().unique())
      .addColumn("password_hash", "text", (c) => c.notNull())
      .addColumn("totp_secret", "text")
      .addColumn("role", "text", (c) => c.notNull().check(sql`role in ('admin', 'viewer')`))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("credentials")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("label", "text", (c) => c.notNull())
      .addColumn("login", "text", (c) => c.notNull())
      .addColumn("secret", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("accounts")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("adapter", "text", (c) => c.notNull())
      .addColumn("number", "text", (c) => c.notNull())
      .addColumn("broker", "text", (c) => c.notNull())
      .addColumn("currency", "text", (c) => c.notNull())
      .addColumn("display_name", "text", (c) => c.notNull())
      .addColumn("credential_id", "integer", (c) => c.references("credentials.id").onDelete("restrict"))
      .addColumn("timezone", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .addUniqueConstraint("accounts_adapter_number_unique", ["adapter", "number"])
      .execute();

    await db.schema
      .createTable("audit_log")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("time", "text", (c) => c.notNull())
      .addColumn("user_id", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("action", "text", (c) => c.notNull())
      .addColumn("target", "text")
      .addColumn("details", "text")
      .execute();
    await db.schema.createIndex("audit_log_time").on("audit_log").column("time").execute();
  },

  async down(db: Kysely<unknown>) {
    for (const table of ["audit_log", "accounts", "credentials", "users"]) {
      await db.schema.dropTable(table).execute();
    }
  },
};
