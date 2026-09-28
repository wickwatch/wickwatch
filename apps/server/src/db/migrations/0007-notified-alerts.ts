import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const notifiedAlerts: Migration = {
  async up(db: Kysely<unknown>) {
    // Alerts already sent to the webhook, so a restart neither repeats nor forgets them.
    await db.schema
      .createTable("notified_alerts")
      .addColumn("key", "text", (c) => c.primaryKey())
      .addColumn("level", "text", (c) => c.notNull())
      .addColumn("code", "text", (c) => c.notNull())
      .addColumn("subject", "text", (c) => c.notNull())
      .addColumn("params", "text", (c) => c.notNull())
      .addColumn("raised_at", "text", (c) => c.notNull())
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("notified_alerts").execute();
  },
};
