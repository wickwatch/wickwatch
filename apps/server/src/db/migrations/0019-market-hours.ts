import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const marketHours: Migration = {
  // The last trading hours the broker named per account and symbol: a restart, e.g. during the broker's maintenance,
  // starts with them instead of none.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("market_hours")
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("cascade"))
      .addColumn("symbol", "text", (c) => c.notNull())
      .addColumn("hours", "text", (c) => c.notNull())
      .addColumn("fetched_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("market_hours_pk", ["account_id", "symbol"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("market_hours").execute();
  },
};
