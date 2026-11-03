import { tradingDayStart, type LogLine, type LogRule, type LogRuleEvent, type RuntimeAdapter } from "@wickwatch/core";
import { logRuleMatchers } from "@wickwatch/core/rules";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";
import { auditOutcome } from "./audit";
import { latestConfigIds } from "./instance-configs";
import { setShouldRun } from "./instance-keeper";
import { LogFollower } from "./log-tracker";
import { logRulesOf } from "./parameter-checks";

const INTERVAL_MS = 15_000;
/** How often an instance a rule holds back for its open position is asked again: it costs an overview load. */
const POSITION_RECHECK_MS = 60_000;
/** Count towards the daily limit. */
const ACTED: LogRuleEvent["variant"][] = ["restarted", "stopped"];
/** Count towards the cooldown: a failed action is not tried again on every check either. */
const TRIED: LogRuleEvent["variant"][] = [...ACTED, "failed"];

export interface LogRulesOptions {
  db: Db;
  /** The app's runtime: its actions refresh the overview. */
  runtime: RuntimeAdapter;
  /** Open positions of an instance, undefined when unknown (the broker cannot be asked). */
  openPositions: (name: string) => Promise<number | undefined>;
  log: FastifyBaseLogger;
  intervalMs?: number;
  now?: () => Date;
}

/** An instance the rules of its algo apply to. */
interface Target {
  id: number;
  name: string;
  rules: LogRule[];
}

/** The same rule across saves while its action and pattern stay: its cooldown and daily limit carry on. */
export const ruleKey = (rule: LogRule) => `${rule.action}:${rule.regex ? "regex" : "text"}:${rule.pattern}`;

/**
 * Restarts or stops a running managed instance when a line in its log matches a log rule of its algo
 * (AlgoSettings.logRules), unless the instance opted out. Reads the new lines of each such instance every 15 s, on its
 * own clock rather than on overview loads; lines written before wickwatch started are left alone. A rule with a
 * recovery pattern waits for it for `waitSeconds`. What a rule did is kept in log_rule_actions (cooldown, daily limit,
 * alert) and in the audit log.
 */
export class LogRules {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly follower: LogFollower;
  /** Per instance, when each rule whose line was seen acts unless its recovery line comes first, by ruleKey. */
  private readonly waiting = new Map<string, Map<string, number>>();
  /** Per instance, when its open positions were last asked for. */
  private readonly positionsAsked = new Map<string, number>();
  private readonly now: () => Date;
  private readonly since: string;

  constructor(private readonly options: LogRulesOptions) {
    this.follower = new LogFollower(options.runtime);
    this.now = options.now ?? (() => new Date());
    this.since = this.now().toISOString();
  }

  start(): void {
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const targets = await this.targets();
      const names = new Set(targets.map((t) => t.name));
      for (const name of this.waiting.keys()) if (!names.has(name)) this.waiting.delete(name);
      if (!targets.length) return;
      const instances = new Map((await this.options.runtime.list()).map((i) => [i.ref, i]));
      // One after the other: few instances, and a restart should not overlap another's.
      for (const target of targets) {
        const instance = instances.get(target.name);
        if (!instance) continue;
        const read = await this.follower.read(instance);
        if (read === "unreadable") continue;
        if (read.fresh) this.waiting.delete(target.name);
        if (instance.status === "running") await this.apply(target, read.lines);
      }
    } catch (error) {
      this.options.log.error({ err: error }, "Log rules check failed");
    } finally {
      this.running = false;
    }
  }

  /** The managed instances with log rules: those of their algo's newest settings, unless they opted out. */
  private async targets(): Promise<Target[]> {
    const rows = await this.options.db
      .selectFrom("instances")
      .innerJoin("instance_configs", "instance_configs.instance_id", "instances.id")
      .innerJoin("algo_settings", "algo_settings.algo_name", "instance_configs.algo_name")
      .select(["instances.id", "instances.name", "algo_settings.log_rules"])
      .where("instance_configs.id", "in", latestConfigIds(this.options.db))
      .where("instances.log_rules_off", "=", 0)
      .where("algo_settings.log_rules", "is not", null)
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, rules: logRulesOf(r.log_rules) })).filter((t) => t.rules.length);
  }

  private async apply(target: Target, lines: LogLine[]): Promise<void> {
    const waiting = this.waiting.get(target.name) ?? new Map<string, number>();
    this.waiting.set(target.name, waiting);
    const rules = target.rules.map((rule) => ({ rule, key: ruleKey(rule), ...logRuleMatchers(rule) }));
    // A rule removed meanwhile does not act.
    for (const key of waiting.keys()) if (!rules.some((r) => r.key === key)) waiting.delete(key);
    const due: LogRule[] = [];
    for (const line of lines) {
      if (line.time < this.since) continue;
      for (const { rule, key, matches, recovers } of rules) {
        if (waiting.has(key) && recovers(line.text)) waiting.delete(key);
        else if (matches(line.text) && !waiting.has(key)) {
          if (rule.recoveryPattern === undefined) due.push(rule);
          else waiting.set(key, Date.parse(line.time) + rule.waitSeconds * 1000);
        }
      }
    }
    const now = this.now();
    for (const { rule, key } of rules) {
      const at = waiting.get(key);
      if (at === undefined || at > now.getTime()) continue;
      waiting.delete(key);
      due.push(rule);
    }
    // One action per check: after a restart or stop the rules start over with the new log.
    const rule = due[0];
    if (rule && (await this.act(target, rule, now))) this.waiting.delete(target.name);
  }

  /**
   * Restarts or stops the instance unless the cooldown, the daily limit or an open position holds it back; whether it
   * was tried.
   */
  private async act(target: Target, rule: LogRule, now: Date): Promise<boolean> {
    const { db, runtime, log } = this.options;
    const key = ruleKey(rule);
    const day = tradingDayStart(now).toISOString();
    const cooldown = new Date(now.getTime() - rule.cooldownMinutes * 60_000).toISOString();
    const rows = await db
      .selectFrom("log_rule_actions")
      .select(["variant", "at"])
      .where("instance_id", "=", target.id)
      .where("rule", "=", key)
      .where("at", ">=", day < cooldown ? day : cooldown)
      .execute();
    const seen = (variants: LogRuleEvent["variant"][], from: string) =>
      rows.filter((r) => variants.includes(r.variant) && r.at >= from).length;
    const record = (variant: LogRuleEvent["variant"]) =>
      db
        .insertInto("log_rule_actions")
        .values({ instance_id: target.id, rule: key, pattern: rule.pattern, variant, at: now.toISOString() })
        .execute();
    if (seen(TRIED, cooldown)) return false;
    // Said once a day, and once per cooldown for an open position: the alert stays up meanwhile.
    if (seen(ACTED, day) >= rule.maxPerDay) {
      if (!seen(["limit"], day)) await record("limit");
      return false;
    }
    if (!rule.withOpenPosition) {
      const asked = this.positionsAsked.get(target.name);
      if (asked !== undefined && now.getTime() - asked < POSITION_RECHECK_MS) return false;
      this.positionsAsked.set(target.name, now.getTime());
      const open = await this.options.openPositions(target.name);
      if (open === undefined) return false;
      if (open > 0) {
        if (!seen(["open_position"], cooldown)) await record("open_position");
        return false;
      }
    }
    const details = { pattern: rule.pattern, action: rule.action };
    const variant = await auditOutcome(
      db,
      { action: "instance.log_rule", target: target.name },
      async () => {
        if (rule.action === "stop") {
          // Not meant to run any more, so the keeper does not start it again. Not stopped "by the user": the
          // instance_stopped alert stays while it is down, after the log rule's own alert is gone.
          await setShouldRun(db, target.name, false);
          await runtime.stop(target.name);
          return "stopped" as const;
        }
        await runtime.restart(target.name);
        return "restarted" as const;
      },
      () => details,
    ).catch((error: unknown) => {
      log.error({ err: error, instance: target.name, ...details }, "Log rule action failed");
      return "failed" as const;
    });
    log.warn({ instance: target.name, ...details, variant }, "Log rule acted");
    await record(variant);
    return true;
  }
}

/**
 * What the log rules last did to each instance today or within `withinMs`, by instance name, with today's restarts and
 * stops of that rule (UTC day), for the overview's alerts (which show only those within its alert window).
 */
export async function logRuleEvents(db: Db, now: Date, withinMs: number): Promise<Map<string, LogRuleEvent>> {
  const day = tradingDayStart(now).toISOString();
  const window = new Date(now.getTime() - withinMs).toISOString();
  const rows = await db
    .selectFrom("log_rule_actions")
    .innerJoin("instances", "instances.id", "log_rule_actions.instance_id")
    .select(["instances.name", "log_rule_actions.rule", "log_rule_actions.pattern", "log_rule_actions.variant"])
    .select("log_rule_actions.at")
    .where("log_rule_actions.at", ">=", day < window ? day : window)
    .orderBy("log_rule_actions.id")
    .execute();
  const counts = new Map<string, number>();
  const last = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.name}\u0000${row.rule}`;
    if (ACTED.includes(row.variant) && row.at >= day) counts.set(key, (counts.get(key) ?? 0) + 1);
    last.set(row.name, row);
  }
  return new Map(
    [...last].map(([name, row]) => [
      name,
      { variant: row.variant, pattern: row.pattern, at: row.at, count: counts.get(`${name}\u0000${row.rule}`) ?? 0 },
    ]),
  );
}
