import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const parameterTemplates: Migration = {
  // Named parameter values of an algo, applied to any of its instances. Bound to the algo's name, not a version.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("parameter_templates")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("algo_name", "text", (c) => c.notNull())
      .addColumn("name", "text", (c) => c.notNull())
      // ParameterValues as JSON, encrypted with the master key: they may hold licence keys.
      .addColumn("parameters", "text", (c) => c.notNull())
      // ParameterTemplateSource as JSON.
      .addColumn("source", "text")
      .addColumn("created_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("updated_at", "text", (c) => c.notNull())
      .addUniqueConstraint("parameter_templates_name_unique", ["algo_name", "name"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("parameter_templates").execute();
  },
};
