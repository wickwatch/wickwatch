import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const tradingDaysFrom: Migration = {
  // The trading day from which the poller has marked all trading days of the account. Until it reaches the
  // profile's start date (new profile, earlier start), the trading-day count is still being loaded.
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("challenge_profiles").addColumn("trading_days_from", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("challenge_profiles").dropColumn("trading_days_from").execute();
  },
};
