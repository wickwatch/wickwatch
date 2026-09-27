import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, createMigrator, migrateToLatest, type Db } from "../src/db";

let db: Db;
afterEach(async () => {
  await db.destroy();
});

describe("database", () => {
  it("migrates up, is idempotent and migrates down", async () => {
    db = createDatabase({ client: "sqlite", filename: ":memory:" });
    expect((await migrateToLatest(db)).map((r) => r.status)).toEqual(["Success"]);
    expect(await migrateToLatest(db)).toEqual([]);

    const tables = (await db.introspection.getTables()).map((t) => t.name).sort();
    expect(tables).toEqual(["accounts", "audit_log", "credentials", "users"]);

    const { error } = await createMigrator(db).migrateDown();
    expect(error).toBeUndefined();
    expect(await db.introspection.getTables()).toEqual([]);
  });

  it("enforces roles and foreign keys", async () => {
    db = createDatabase({ client: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    const now = new Date().toISOString();
    const user = { username: "admin", password_hash: "x", totp_secret: null, created_at: now, updated_at: now };

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
