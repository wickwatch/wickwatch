import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const images: Migration = {
  // Settings an admin changes in the dashboard (the platform image new instances run on), and the image each instance
  // runs on, so deploying a new configuration keeps it and only an update changes it.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("settings")
      .addColumn("key", "text", (c) => c.primaryKey())
      .addColumn("value", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.alterTable("instances").addColumn("image", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("instances").dropColumn("image").execute();
    await db.schema.dropTable("settings").execute();
  },
};
