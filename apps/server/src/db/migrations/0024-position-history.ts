import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const positionHistory: Migration = {
  // Volume, entry, stop loss and take profit of a position as seen over time (services/position-history.ts): the
  // first row when it was first seen, one more whenever one of them differed.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("position_history")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("cascade"))
      .addColumn("position_id", "text", (c) => c.notNull())
      .addColumn("volume", "real", (c) => c.notNull())
      .addColumn("entry", "real", (c) => c.notNull())
      .addColumn("sl", "real")
      .addColumn("tp", "real")
      .addColumn("at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createIndex("position_history_position")
      .on("position_history")
      .columns(["account_id", "position_id", "id"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("position_history").execute();
  },
};
