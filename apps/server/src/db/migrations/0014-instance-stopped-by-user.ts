import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const instanceStoppedByUser: Migration = {
  // Whether a managed instance was stopped on purpose through wickwatch (stop, emergency stop, loss guard, applying a
  // version without starting it). Such an instance raises no "is stopped" alert; a bot that stopped itself still does.
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("instances")
      .addColumn("stopped_by_user", "integer", (c) => c.notNull().defaultTo(0))
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("instances").dropColumn("stopped_by_user").execute();
  },
};
