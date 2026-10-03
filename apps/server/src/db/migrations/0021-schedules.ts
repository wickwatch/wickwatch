import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const schedules: Migration = {
  // Schedules pause instances on weekends, holidays and around news (services/scheduler.ts); the news calendar is kept
  // so a restart does not wait for the next fetch.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("schedules")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("name", "text", (c) => c.notNull().unique())
      .addColumn("rules", "text", (c) => c.notNull())
      .addColumn("created_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createTable("news_events")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("time", "text", (c) => c.notNull())
      .addColumn("currency", "text", (c) => c.notNull())
      .addColumn("impact", "text", (c) => c.notNull())
      .addColumn("title", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("news_events_time").on("news_events").column("time").execute();
    await db.schema
      .alterTable("instances")
      .addColumn("schedule_id", "integer", (c) => c.references("schedules.id").onDelete("set null"))
      .execute();
    // The start of the pause the scheduler last handled, so it stops an instance once per pause.
    await db.schema.alterTable("instances").addColumn("schedule_window", "text").execute();
    // Set while the scheduler stopped the instance: only these are started again when the pause ends.
    await db.schema.alterTable("instances").addColumn("paused_until", "text").execute();
    await db.schema.alterTable("instances").addColumn("pause_reasons", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    for (const column of ["pause_reasons", "paused_until", "schedule_window", "schedule_id"]) {
      await db.schema.alterTable("instances").dropColumn(column).execute();
    }
    await db.schema.dropTable("news_events").execute();
    await db.schema.dropTable("schedules").execute();
  },
};
