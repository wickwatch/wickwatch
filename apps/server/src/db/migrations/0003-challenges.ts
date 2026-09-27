import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const challenges: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("challenge_profiles")
      .addColumn("account_id", "integer", (c) => c.primaryKey().references("accounts.id").onDelete("cascade"))
      .addColumn("template_id", "text")
      /** ChallengeProfile as JSON, validated against the core schema on read and write. */
      .addColumn("profile", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();

    // One row per account and trading day (day = local date of the reset in the profile's time zone).
    await db.schema
      .createTable("daily_stats")
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("cascade"))
      .addColumn("day", "text", (c) => c.notNull())
      .addColumn("start_balance", "real")
      .addColumn("start_equity", "real")
      .addColumn("min_equity", "real")
      .addColumn("max_equity", "real")
      .addColumn("first_sample_at", "text")
      .addColumn("last_sample_at", "text")
      .addColumn("traded", "integer", (c) => c.notNull().defaultTo(0))
      .addPrimaryKeyConstraint("daily_stats_pk", ["account_id", "day"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("daily_stats").execute();
    await db.schema.dropTable("challenge_profiles").execute();
  },
};
