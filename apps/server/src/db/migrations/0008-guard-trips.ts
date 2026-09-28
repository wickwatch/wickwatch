import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const guardTrips: Migration = {
  async up(db: Kysely<unknown>) {
    // The loss guard acts once per account and trading day; a failed attempt is retried (ok = 0).
    await db.schema
      .createTable("guard_trips")
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("cascade"))
      .addColumn("day", "text", (c) => c.notNull())
      .addColumn("rule", "text", (c) => c.notNull())
      .addColumn("usage", "real", (c) => c.notNull())
      .addColumn("ok", "integer", (c) => c.notNull())
      .addColumn("at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("guard_trips_pk", ["account_id", "day"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("guard_trips").execute();
  },
};
