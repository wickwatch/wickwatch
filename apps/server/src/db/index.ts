import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator, type MigrationResult } from "kysely/migration";
import type { Config } from "../config";
import { migrations } from "./migrations";
import type { Database } from "./schema";

export type { Database } from "./schema";
export type Db = Kysely<Database>;

export function createDatabase(config: Config["database"]): Db {
  return new Kysely<Database>({
    dialect: new SqliteDialect({
      database: () => {
        if (config.filename !== ":memory:") mkdirSync(dirname(config.filename), { recursive: true });
        const sqlite = new SQLite(config.filename);
        sqlite.pragma("journal_mode = WAL");
        sqlite.pragma("foreign_keys = ON");
        sqlite.pragma("busy_timeout = 5000");
        return Promise.resolve(sqlite);
      },
    }),
  });
}

export function createMigrator(db: Db): Migrator {
  return new Migrator({ db, provider: { getMigrations: () => Promise.resolve(migrations) } });
}

/** Applies all pending migrations; throws if one fails. */
export async function migrateToLatest(db: Db): Promise<MigrationResult[]> {
  const { error, results = [] } = await createMigrator(db).migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error("Database migration failed", { cause: error });
  return results;
}
