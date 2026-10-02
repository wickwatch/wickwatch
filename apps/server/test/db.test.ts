import { NO_MIGRATIONS } from "kysely/migration";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, createMigrator, migrateToLatest, type Db } from "../src/db";

let db: Db;
afterEach(async () => {
  await db.destroy();
});

describe("database", () => {
  it("repairs colour parameters of algos uploaded before the colour type", async () => {
    db = createDatabase({ client: "sqlite", filename: ":memory:" });
    await createMigrator(db).migrateTo("0008-guard-trips");
    const metadata = {
      name: "Oldman",
      parameters: [
        { name: "SLColor", type: "string", default: { A: 255, R: 255, G: 0, B: 0 } },
        { name: "Tag", type: "string", default: "x" },
      ],
    };
    await db
      .insertInto("algos")
      .values({
        name: "Oldman",
        version: "4.03",
        sha256: "a".repeat(64),
        file_path: "Oldman/4.03/Oldman.algo",
        size: 1,
        build_time: null,
        full_access: 1,
        metadata: JSON.stringify(metadata),
        uploaded_by: null,
        uploaded_at: "2026-09-28T00:00:00.000Z",
      })
      .execute();
    await migrateToLatest(db);
    const row = await db.selectFrom("algos").select("metadata").executeTakeFirstOrThrow();
    expect((JSON.parse(row.metadata) as typeof metadata).parameters).toEqual([
      { name: "SLColor", type: "color", default: "#FFFF0000" },
      { name: "Tag", type: "string", default: "x" },
    ]);
  });

  it("migrates up, is idempotent and migrates down", async () => {
    db = createDatabase({ client: "sqlite", filename: ":memory:" });
    expect((await migrateToLatest(db)).map((r) => r.status)).toEqual(Array(18).fill("Success"));
    expect(await migrateToLatest(db)).toEqual([]);

    const tables = (await db.introspection.getTables()).map((t) => t.name).sort();
    expect(tables).toEqual([
      "accounts",
      "algo_settings",
      "algos",
      "api_tokens",
      "attribution_overrides",
      "audit_log",
      "challenge_profiles",
      "credentials",
      "daily_stats",
      "daily_summaries",
      "guard_trips",
      "instance_configs",
      "instances",
      "notified_alerts",
      "parameter_templates",
      "sessions",
      "users",
    ]);

    const { error } = await createMigrator(db).migrateTo(NO_MIGRATIONS);
    expect(error).toBeUndefined();
    expect(await db.introspection.getTables()).toEqual([]);
  });

  it("enforces roles and foreign keys", async () => {
    db = createDatabase({ client: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    const now = new Date().toISOString();
    const user = {
      username: "admin",
      password_hash: "x",
      totp_secret: null,
      totp_last_counter: null,
      created_at: now,
      updated_at: now,
    };

    await expect(
      db
        .insertInto("users")
        .values({ ...user, role: "root" as "admin" })
        .execute(),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      db
        .insertInto("accounts")
        .values({
          adapter: "demo",
          number: "1111111",
          broker: "Demo",
          currency: "USD",
          display_name: "Demo",
          credential_id: 99,
          timezone: null,
          created_at: now,
          updated_at: now,
        })
        .execute(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});
