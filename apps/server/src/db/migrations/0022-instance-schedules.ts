import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

export const instanceSchedules: Migration = {
  // An instance can have several schedules (it is paused while any of them pauses), a schedule several instances.
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("instance_schedules")
      .addColumn("instance_id", "integer", (c) => c.notNull().references("instances.id").onDelete("cascade"))
      .addColumn("schedule_id", "integer", (c) => c.notNull().references("schedules.id").onDelete("cascade"))
      .addPrimaryKeyConstraint("instance_schedules_pk", ["instance_id", "schedule_id"])
      .execute();
    await sql`insert into instance_schedules (instance_id, schedule_id)
      select id, schedule_id from instances where schedule_id is not null`.execute(db);
    await db.schema.alterTable("instances").dropColumn("schedule_id").execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema
      .alterTable("instances")
      .addColumn("schedule_id", "integer", (c) => c.references("schedules.id").onDelete("set null"))
      .execute();
    await sql`update instances set schedule_id =
      (select min(schedule_id) from instance_schedules where instance_id = instances.id)`.execute(db);
    await db.schema.dropTable("instance_schedules").execute();
  },
};
