import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "kysely";
import type { FastifyBaseLogger } from "fastify";
import { deleteExpiredSessions } from "../auth/sessions";
import type { Db } from "../db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** `wickwatch-20260928T164000Z.db`: sorts by time. */
const BACKUP_FILE = /^wickwatch-(\d{8}T\d{6}Z)\.db$/;

export interface MaintenanceOptions {
  db: Db;
  log: FastifyBaseLogger;
  /** Audit entries older than this are deleted; 0 keeps them forever. */
  auditRetentionDays: number;
  /** Missing: no backups (e.g. an in-memory database). */
  backup?: { dir: string; intervalHours: number; keep: number };
  now?: () => Date;
}

const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
const parseStamp = (text: string) =>
  Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));

/**
 * Hourly housekeeping: expired sessions, old audit entries, and a database backup when the last
 * one is older than the interval (also right after a start, so restarts never skip one).
 */
export class Maintenance {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => Date;

  constructor(private readonly options: MaintenanceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), HOUR_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async run(): Promise<void> {
    const { db, log, auditRetentionDays } = this.options;
    const now = this.now();
    try {
      await deleteExpiredSessions(db, now);
      if (auditRetentionDays > 0) {
        const before = new Date(now.getTime() - auditRetentionDays * DAY_MS).toISOString();
        await db.deleteFrom("audit_log").where("time", "<", before).execute();
      }
    } catch (error) {
      log.error({ err: error }, "Cleaning up the database failed");
    }
    if (this.options.backup) {
      try {
        const file = await this.backupIfDue(this.options.backup, now);
        if (file) log.info({ file }, "Database backup written");
      } catch (error) {
        log.error({ err: error }, "Database backup failed");
      }
    }
  }

  /** Writes a backup when due; returns its path, or undefined when the last one is recent enough. */
  async backupIfDue(backup: NonNullable<MaintenanceOptions["backup"]>, now = this.now()): Promise<string | undefined> {
    if (backup.intervalHours <= 0) return undefined;
    await mkdir(backup.dir, { recursive: true, mode: 0o700 });
    const existing = (await readdir(backup.dir)).filter((f) => BACKUP_FILE.test(f)).sort();
    const last = existing.at(-1)?.match(BACKUP_FILE)?.[1];
    if (last && now.getTime() - parseStamp(last) < backup.intervalHours * HOUR_MS) return undefined;

    const name = `wickwatch-${stamp(now)}.db`;
    const path = join(backup.dir, name);
    // A consistent copy of the live database (WAL included); written under another name first,
    // so a half-written file never counts as a backup.
    const partial = `${path}.partial`;
    await rm(partial, { force: true });
    await sql`VACUUM INTO ${partial}`.execute(this.options.db);
    await chmod(partial, 0o600);
    await rename(partial, path);

    const all = [...existing, name];
    for (const old of all.slice(0, Math.max(0, all.length - backup.keep))) {
      await rm(join(backup.dir, old), { force: true });
    }
    return path;
  }
}
