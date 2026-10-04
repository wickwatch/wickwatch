import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const sessionRemember: Migration = {
  // "Stay logged in": such a session lasts 30 days without an idle timeout, its cookie outlives the browser.
  // The user agent names the device in the profile's list of sessions.
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable("sessions")
      .addColumn("remember", "integer", (c) => c.notNull().defaultTo(0))
      .execute();
    await db.schema.alterTable("sessions").addColumn("user_agent", "text").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("sessions").dropColumn("user_agent").execute();
    await db.schema.alterTable("sessions").dropColumn("remember").execute();
  },
};
