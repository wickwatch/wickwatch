import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, migrateToLatest, type Db } from "../src/db";
import { Maintenance } from "../src/services/maintenance";

const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
const at = (iso: string) => new Date(iso);

let dir: string;
let db: Db;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ww-maint-"));
  db = createDatabase({ client: "sqlite", filename: join(dir, "wickwatch.db") });
  await migrateToLatest(db);
});
afterEach(async () => {
  await db.destroy();
});

const backups = () => readdirSync(join(dir, "backups")).sort();

describe("Maintenance", () => {
  it("writes a readable backup when due and keeps the newest ones", async () => {
    await db
      .insertInto("audit_log")
      .values({ time: "2026-09-28T10:00:00.000Z", user_id: null, action: "test", target: null, details: null })
      .execute();
    const backup = { dir: join(dir, "backups"), intervalHours: 24, keep: 2 };
    const m = new Maintenance({ db, log, auditRetentionDays: 0, backup });

    const first = await m.backupIfDue(backup, at("2026-09-28T16:40:00.000Z"));
    expect(first).toBe(join(dir, "backups", "wickwatch-20260928T164000Z.db"));
    expect(statSync(first ?? "").mode & 0o777).toBe(0o600);
    const copy = createDatabase({ client: "sqlite", filename: first ?? "" });
    expect(await copy.selectFrom("audit_log").select("action").execute()).toEqual([{ action: "test" }]);
    await copy.destroy();

    // Not due yet.
    expect(await m.backupIfDue(backup, at("2026-09-29T10:00:00.000Z"))).toBeUndefined();
    await m.backupIfDue(backup, at("2026-09-29T16:40:00.000Z"));
    writeFileSync(join(dir, "backups", "keep-me.txt"), "");
    await m.backupIfDue(backup, at("2026-09-30T16:40:00.000Z"));
    expect(backups()).toEqual(["keep-me.txt", "wickwatch-20260929T164000Z.db", "wickwatch-20260930T164000Z.db"]);
  });

  it("deletes expired sessions and audit entries older than the retention", async () => {
    await db
      .insertInto("audit_log")
      .values([
        { time: "2025-09-01T00:00:00.000Z", user_id: null, action: "old", target: null, details: null },
        { time: "2026-09-01T00:00:00.000Z", user_id: null, action: "recent", target: null, details: null },
      ])
      .execute();
    await new Maintenance({ db, log, auditRetentionDays: 365, now: () => at("2026-09-28T00:00:00.000Z") }).run();
    expect(await db.selectFrom("audit_log").select("action").execute()).toEqual([{ action: "recent" }]);

    await new Maintenance({ db, log, auditRetentionDays: 0, now: () => at("2036-01-01T00:00:00.000Z") }).run();
    expect(await db.selectFrom("audit_log").select("action").execute()).toEqual([{ action: "recent" }]);
  });
});
