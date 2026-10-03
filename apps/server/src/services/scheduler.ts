import { pauseWindows, type PauseWindow, type RuntimeAdapter, type ScheduleRules } from "@wickwatch/core";
import { isUp } from "@wickwatch/core/rules";
import type { Updateable } from "kysely";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";
import type { InstancesTable } from "../db/schema";
import { auditOutcome } from "./audit";
import type { NewsCalendar } from "./news-calendar";
import { DAY_MS, rulesOf } from "./schedules";

const INTERVAL_MS = 30_000;

/**
 * Pauses the instances that have a schedule: when one of its pauses begins (weekend, holiday, news), a running
 * instance is stopped and marked as paused, which raises no alert and is not started by the instance keeper; when the
 * pause ends, only the instances it paused are started again. Each pause is handled once: an instance started or
 * stopped by hand during it stays as the user left it. Positions stay open; the bots take them over when they start.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      db: Db;
      runtime: RuntimeAdapter;
      news: NewsCalendar;
      log: FastifyBaseLogger;
      intervalMs?: number;
      now?: () => Date;
    },
  ) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? INTERVAL_MS);
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
      this.options.log.warn({ err: error }, "Schedule check failed");
    } finally {
      this.running = false;
    }
  }

  private async checkOnce(): Promise<void> {
    const { db, runtime, news, log } = this.options;
    // The instances with schedules, and those a pause is still marked on.
    const rows = await db
      .selectFrom("instances")
      .leftJoin("instance_schedules", "instance_schedules.instance_id", "instances.id")
      .leftJoin("schedules", "schedules.id", "instance_schedules.schedule_id")
      .select(["instances.name", "instances.schedule_window", "instances.paused_until", "schedules.rules"])
      .where((eb) =>
        eb.or([
          eb("schedules.id", "is not", null),
          eb("instances.paused_until", "is not", null),
          eb("instances.schedule_window", "is not", null),
        ]),
      )
      .execute();
    if (!rows.length) return;
    const instances = new Map<string, { window: string | null; until: string | null; rules: ScheduleRules[] }>();
    for (const row of rows) {
      const entry = instances.get(row.name) ?? { window: row.schedule_window, until: row.paused_until, rules: [] };
      const rules = row.rules === null ? undefined : rulesOf(row.rules);
      if (rules) entry.rules.push(rules);
      instances.set(row.name, entry);
    }

    const now = this.now();
    const all = [...instances.values()].flatMap((i) => i.rules);
    if (all.some((r) => r.news)) await news.refresh();
    const events = all.some((r) => r.news)
      ? await news.events(new Date(now.getTime() - DAY_MS), new Date(now.getTime() + DAY_MS))
      : [];
    const until = new Date(now.getTime() + 1);
    // Paused while any of its schedules pauses: one pause over all of them.
    const plan = [...instances].map(([name, i]) => ({
      name,
      ...i,
      pause: pauseWindows(i.rules, events, now, until)[0],
    }));
    // The runtime is asked only when a pause begins for one of them.
    const beginning = plan.some((p) => p.pause && p.window !== p.pause.start);
    const status = new Map(beginning ? (await runtime.list()).map((i) => [i.ref, i.status]) : []);

    for (const { name, window, until: pausedUntil, pause } of plan) {
      try {
        if (pause && window !== pause.start) {
          if (isUp(status.get(name))) await this.pause(name, pause);
          else await this.set(name, { schedule_window: pause.start });
        } else if (pause && pausedUntil && pausedUntil !== pause.end) {
          // The pause grew, e.g. news right after a weekend.
          await this.set(name, { paused_until: pause.end, pause_reasons: pause.reasons.join(",") });
        } else if (!pause && pausedUntil) {
          await this.resume(name);
        } else if (!pause && window) {
          await this.set(name, { schedule_window: null });
        }
      } catch (error) {
        log.warn({ err: error, instance: name }, "Schedule action failed");
      }
    }
  }

  private async set(name: string, values: Updateable<InstancesTable>): Promise<void> {
    await this.options.db.updateTable("instances").set(values).where("name", "=", name).execute();
  }

  /**
   * Not meant to run and stopped on purpose, in one step before the stop, so neither the instance keeper nor an alert
   * reacts to it; `paused_until` marks it as the scheduler's to start again.
   */
  private async pause(name: string, pause: PauseWindow): Promise<void> {
    await this.set(name, {
      should_run: 0,
      stopped_by_user: 1,
      schedule_window: pause.start,
      paused_until: pause.end,
      pause_reasons: pause.reasons.join(","),
    });
    await auditOutcome(
      this.options.db,
      { action: "instance.schedule_pause", target: name },
      () => this.options.runtime.stop(name),
      () => ({ until: pause.end, reasons: pause.reasons, labels: pause.labels }),
    );
  }

  private async resume(name: string): Promise<void> {
    try {
      await auditOutcome(this.options.db, { action: "instance.schedule_resume", target: name }, () =>
        this.options.runtime.start(name),
      );
    } finally {
      // Meant to run either way: if the start failed, the "stopped" alert says so.
      await this.set(name, {
        should_run: 1,
        stopped_by_user: 0,
        schedule_window: null,
        paused_until: null,
        pause_reasons: null,
      });
    }
  }
}
