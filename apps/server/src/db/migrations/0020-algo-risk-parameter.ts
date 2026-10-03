import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const algoRiskParameter: Migration = {
  // The parameter holding an algo's risk per trade in percent, for the risk preview.
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("algo_settings").addColumn("risk_parameter", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("algo_settings").dropColumn("risk_parameter").execute();
  },
};
