import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const logRules: Migration = {
  // Log rules of an algo (AlgoSettings.logRules), an instance's opt-out, and what the rules did (services/log-rules.ts):
  // for the cooldown, the daily limit and the alert.
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("algo_settings").addColumn("log_rules", "text").execute();
    await db.schema
      .alterTable("instances")
      .addColumn("log_rules_off", "integer", (c) => c.notNull().defaultTo(0))
      .execute();
    await db.schema
      .createTable("log_rule_actions")
      .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
      .addColumn("instance_id", "integer", (c) => c.notNull().references("instances.id").onDelete("cascade"))
      .addColumn("rule", "text", (c) => c.notNull())
      .addColumn("pattern", "text", (c) => c.notNull())
      .addColumn("variant", "text", (c) => c.notNull())
      .addColumn("at", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createIndex("log_rule_actions_rule")
      .on("log_rule_actions")
      .columns(["instance_id", "rule", "at"])
      .execute();
    await db.schema.createIndex("log_rule_actions_at").on("log_rule_actions").column("at").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("log_rule_actions").execute();
    await db.schema.alterTable("instances").dropColumn("log_rules_off").execute();
    await db.schema.alterTable("algo_settings").dropColumn("log_rules").execute();
  },
};
