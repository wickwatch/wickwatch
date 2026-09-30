import type { Db } from "../db";

/** Subquery: the id of each instance's current (latest) configuration version. */
export const latestConfigIds = (db: Db) =>
  db
    .selectFrom("instance_configs")
    .select((eb) => eb.fn.max("id").as("id"))
    .groupBy("instance_id");
