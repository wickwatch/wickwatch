import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const attributionOverrides: Migration = {
  async up(db: Kysely<unknown>) {
    // Manual attribution of a position (and its deals): an instance name, or null for "no instance".
    await db.schema
      .createTable("attribution_overrides")
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("cascade"))
      .addColumn("position_id", "text", (c) => c.notNull())
      .addColumn("instance", "text")
      .addColumn("user_id", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("attribution_overrides_pk", ["account_id", "position_id"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("attribution_overrides").execute();
  },
};
