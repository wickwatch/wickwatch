import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const dailySummaries: Migration = {
  // The days the daily summary was sent (services/daily-summary.ts), so a restart does not send it twice.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("daily_summaries")
      .addColumn("day", "text", (c) => c.primaryKey())
      .addColumn("sent_at", "text", (c) => c.notNull())
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("daily_summaries").execute();
  },
};
