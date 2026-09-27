import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const algos: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("algos")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("version", "text", (c) => c.notNull())
      .addColumn("sha256", "text", (c) => c.notNull().unique())
      /** Relative to ALGOS_DIR: <name>/<version>/<name>.algo */
      .addColumn("file_path", "text", (c) => c.notNull())
      .addColumn("size", "integer", (c) => c.notNull())
      .addColumn("build_time", "text")
      .addColumn("full_access", "integer", (c) => c.notNull().defaultTo(0))
      /** AlgoMetadata as JSON (parameters with types, defaults, ranges). */
      .addColumn("metadata", "text", (c) => c.notNull())
      .addColumn("uploaded_by", "integer", (c) => c.references("users.id").onDelete("set null"))
      .addColumn("uploaded_at", "text", (c) => c.notNull())
      .addUniqueConstraint("algos_name_version_unique", ["name", "version"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("algos").execute();
  },
};
