import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const algoSettings: Migration = {
  // Settings of an algo by its name, for all its versions; like parameter templates they outlive the versions.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("algo_settings")
      .addColumn("algo_name", "text", (c) => c.primaryKey())
      .addColumn("account_size_parameter", "text")
      .addColumn("updated_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("algo_settings").execute();
  },
};
