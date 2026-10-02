import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const auditApiToken: Migration = {
  // The API token an action came through, next to its user. No foreign key: the entry outlives a deleted token, so
  // its name is kept as it was.
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("audit_log").addColumn("api_token_id", "integer").execute();
    await db.schema.alterTable("audit_log").addColumn("api_token", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("audit_log").dropColumn("api_token").execute();
    await db.schema.alterTable("audit_log").dropColumn("api_token_id").execute();
  },
};
