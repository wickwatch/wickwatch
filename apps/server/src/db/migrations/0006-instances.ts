import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const instances: Migration = {
  async up(db: Kysely<unknown>) {
    // Instances set up in wickwatch; containers defined elsewhere (e.g. compose) are not listed here.
    await db.schema
      .createTable("instances")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      /** Also the runtime ref (container name) once it is deployed. */
      .addColumn("name", "text", (c) => c.notNull().unique())
      .addColumn("account_id", "integer", (c) => c.notNull().references("accounts.id").onDelete("restrict"))
      .addColumn("created_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();

    // Every save adds a version; the highest one is the current configuration.
    await db.schema
      .createTable("instance_configs")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("instance_id", "integer", (c) => c.notNull().references("instances.id").onDelete("cascade"))
      .addColumn("version", "integer", (c) => c.notNull())
      /** Null once an old algo version was deleted; name and version stay for the history. */
      .addColumn("algo_id", "integer", (c) => c.references("algos.id").onDelete("set null"))
      .addColumn("algo_name", "text", (c) => c.notNull())
      .addColumn("algo_version", "text", (c) => c.notNull())
      .addColumn("symbol", "text", (c) => c.notNull())
      .addColumn("period", "text", (c) => c.notNull())
      /** ParameterValues as JSON. */
      .addColumn("parameters", "text", (c) => c.notNull())
      .addColumn("attribution", "text", (c) => c.notNull())
      .addColumn("order_label", "text")
      .addColumn("comment", "text")
      .addColumn("created_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addUniqueConstraint("instance_configs_version_unique", ["instance_id", "version"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("instance_configs").execute();
    await db.schema.dropTable("instances").execute();
  },
};
