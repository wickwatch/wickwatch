import {
  emergencyStopAccount,
  type EmergencyStopOptions,
  type EmergencyStopReport,
  type RuntimeAdapter,
  type RuntimeInstance,
} from "@wickwatch/core";
import { isUp } from "@wickwatch/core/rules";
import type { FastifyBaseLogger } from "fastify";
import type { AccountEntry } from "../accounts";
import type { Db } from "../db";
import { audit } from "./audit";

const INTERVAL_MS = 15_000;
/** A bot that ends again this soon after being started automatically is not started a third time. */
const GIVE_UP_WITHIN_MS = 10 * 60_000;
/** How far back the log is read to tell a self-stop from a stop from outside. */
const LOG_TAIL = 15;

/**
 * Marks a managed instance as meant to run or not; no-op for instances wickwatch does not manage. `byUser`: the user
 * stopped it (or chose not to start it), so its being stopped raises no alert. Any other stop, e.g. a bot that stopped
 * itself, and every start clear that again.
 */
export async function setShouldRun(
  db: Db,
  names: string | string[],
  shouldRun: boolean,
  byUser = false,
): Promise<void> {
  const list = Array.isArray(names) ? names : [names];
  if (!list.length) return;
  await db
    .updateTable("instances")
    .set({ should_run: shouldRun ? 1 : 0, stopped_by_user: !shouldRun && byUser ? 1 : 0 })
    .where("name", "in", list)
    .execute();
}

/**
 * Emergency stop of an account, by hand or by the loss guard. Its instances are first marked as no longer meant to run,
 * so they are not started again after a restart; the credentials are read only after that. They count as stopped on
 * purpose: the user knows, and the loss guard raises an alert of its own.
 */
export async function stopAccount(
  db: Db,
  entry: AccountEntry,
  options: Omit<EmergencyStopOptions, "credentials" | "account">,
): Promise<EmergencyStopReport> {
  await db
    .updateTable("instances")
    .set({ should_run: 0, stopped_by_user: 1 })
    .where("account_id", "=", entry.id)
    .execute();
  return emergencyStopAccount({ ...options, account: entry.number, credentials: await entry.credentials() });
}

/**
 * Keeps managed instances running that are meant to run, like a supervisor. Docker's `on-failure` restarts a bot that
 * crashed, but not one that ended cleanly: after a host or Docker restart the bots received SIGTERM, exited with 0 and
 * stay down. Docker does not tell such a restart from a `docker stop` outside wickwatch, so both count as an
 * interruption: stopping goes through wickwatch (stop, emergency stop, loss guard), which clears "should run" first.
 *
 * Per check, for each managed instance:
 * - running: at the first check after the server started, it is taken over as meant to run (instances that ran
 *   before this was recorded, or were started while wickwatch was down). Later checks leave "should run" alone for
 *   running instances: a stop clears it before the container is down, and taking it over then would start the
 *   instance right up again (seen with the loss guard);
 * - ended cleanly and its log says it stopped itself (broker adapter event `algo_stopped`): no longer meant to run;
 * - ended cleanly otherwise, while meant to run: started again, audited; if it ends again within ten minutes of an
 *   automatic start, wickwatch gives up and records that instead of looping.
 * An instance in the runtime's "error" state (a real crash, e.g. an exit code other than a stop signal's) is left to
 * the restart policy.
 */
export class InstanceKeeper {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly autostartedAt = new Map<string, number>();
  /** Running instances are taken over only once, see the class comment. */
  private tookOver = false;

  constructor(
    private readonly opts: {
      db: Db;
      runtime: RuntimeAdapter;
      log: FastifyBaseLogger;
      intervalMs?: number;
      now?: () => number;
    },
  ) {}

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.opts.intervalMs ?? INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkOnce();
    } catch (error) {
      this.opts.log.warn({ err: error }, "Instance keeper check failed");
    } finally {
      this.running = false;
    }
  }

  private async checkOnce(): Promise<void> {
    const { db, runtime, log } = this.opts;
    let instances: RuntimeInstance[];
    try {
      instances = await runtime.list();
    } catch {
      // Runtime not reachable (e.g. Docker restarting): nothing to judge until it is back.
      return;
    }
    const byRef = new Map(instances.map((i) => [i.ref, i]));
    const rows = await db.selectFrom("instances").select(["name", "should_run"]).execute();
    for (const row of rows) {
      const instance = byRef.get(row.name);
      if (!instance) continue;
      if (isUp(instance.status)) {
        if (!row.should_run && !this.tookOver) await setShouldRun(db, row.name, true);
        continue;
      }
      // Only clean ends ("stopped" with an exit code); "created" never ran, "error" is left to the restart policy.
      if (!row.should_run || instance.status !== "stopped" || instance.exitCode === undefined) continue;
      if (await this.stoppedItself(instance.ref)) {
        await setShouldRun(db, row.name, false);
        log.info({ instance: row.name }, "Instance stopped itself; it will not be started again automatically");
        continue;
      }
      await this.startAgain(row.name);
    }
    this.tookOver = true;
  }

  /** The runtime must come with the broker's log events (withLogEvents), as the one from createAdapters does. */
  private async stoppedItself(ref: string): Promise<boolean> {
    try {
      for await (const line of this.opts.runtime.logs(ref, { tail: LOG_TAIL })) {
        if (line.event === "algo_stopped") return true;
      }
    } catch {
      // Without a log, treat it as interrupted.
    }
    return false;
  }

  private async startAgain(name: string): Promise<void> {
    const { db, runtime, log } = this.opts;
    const now = (this.opts.now ?? Date.now)();
    const last = this.autostartedAt.get(name);
    if (last !== undefined && now - last < GIVE_UP_WITHIN_MS) {
      await setShouldRun(db, name, false);
      this.autostartedAt.delete(name);
      log.warn({ instance: name }, "Instance ended again right after an automatic start; not starting it again");
      await audit(db, { action: "instance.autostart_gave_up", target: name, details: { ok: false } });
      return;
    }
    try {
      await runtime.start(name);
      this.autostartedAt.set(name, now);
      log.info({ instance: name }, "Instance was interrupted (e.g. host or Docker restart); started it again");
      await audit(db, { action: "instance.autostart", target: name, details: { ok: true } });
    } catch (error) {
      log.warn({ err: error, instance: name }, "Starting an interrupted instance failed; trying again next check");
    }
  }
}
