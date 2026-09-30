import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const instanceShouldRun: Migration = {
  // Whether a managed instance is meant to run, so Wickwatch can start it again after a host or Docker restart
  // (services/instance-keeper.ts). Instances running at the first check are taken over as "should run".
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("instances")
      .addColumn("should_run", "integer", (c) => c.notNull().defaultTo(0))
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("instances").dropColumn("should_run").execute();
  },
};
