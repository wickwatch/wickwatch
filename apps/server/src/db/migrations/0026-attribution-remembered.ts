import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const attributionRemembered: Migration = {
  // The instance the rules gave a position when wickwatch first saw it open (services/overrides.ts), so starting or
  // stopping another instance later does not move it. Manual overrides still come first.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("attribution_remembered")
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("cascade"))
      .addColumn("position_id", "text", (c) => c.notNull())
      .addColumn("instance", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("attribution_remembered_pk", ["account_id", "position_id"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("attribution_remembered").execute();
  },
};
