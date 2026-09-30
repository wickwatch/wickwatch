import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const algoMetadataReader: Migration = {
  // Which reader produced an algo's metadata ("<adapter>:<version>"). Null for algos from before: they are read again
  // once at the next start (services/algo-metadata.ts).
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("algos").addColumn("metadata_reader", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("algos").dropColumn("metadata_reader").execute();
  },
};
