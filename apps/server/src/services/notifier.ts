import { marketState, type Alert, type Overview } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { Locale } from "../config";
import type { Db } from "../db";
import { alertText, type Resolution } from "./alert-text";
import { postJson, REQUEST_TIMEOUT_MS } from "./webhook";

export interface NotifierOptions {
  db: Db;
  /** The current overview; its alerts are what gets notified. */
  load: () => Promise<Overview>;
  /** Receives one JSON POST per raised or resolved alert. */
  webhookUrl?: URL;
  /** Called with GET after every successful check; when the calls stop, the whole server is down. */
  heartbeatUrl?: URL;
  locale: Locale;
  log: FastifyBaseLogger;
  intervalMs?: number;
  /**
   * Alerts about the broker connection (a bot's lost connection, an unreachable account) are only posted once they
   * lasted this long; short drops are no news. Default 0.
   */
  disconnectGraceMs?: number;
  /**
   * The same while the market is closed (of the instance, or of all instances of the account), e.g. during a broker's
   * weekend maintenance; Infinity holds them until the market opens. Default `disconnectGraceMs`.
   */
  disconnectGraceClosedMs?: number;
  /** A posted alert is only resolved once it stayed away this long, so it does not flap back and forth. Default 0. */
  resolveDelayMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** What ALERT_WEBHOOK_URL receives, see docs/CONFIGURATION.md. */
export interface AlertEvent {
  event: "alert_raised" | "alert_resolved";
  time: string;
  level: Alert["level"];
  code: Alert["code"];
  subject: string;
  instance?: string;
  account?: string;
  params: Alert["params"];
  /** One line in DEFAULT_LOCALE; `text` suits Slack, Telegram and ntfy, `content` suits Discord. */
  text: string;
  content: string;
}

const keyOf = (alert: Pick<Alert, "code" | "subject">) => `${alert.code}:${alert.subject}`;

/** Alerts that come and go with the broker's connection, e.g. during its maintenance; a failed login is none. */
const brokerConnection = (alert: Alert) =>
  alert.code === "instance_disconnected" ||
  (alert.code === "account_error" && (alert.params.reason === "timeout" || alert.params.reason === "unavailable"));

const INSTANCE_STATES: Alert["code"][] = ["instance_stopped", "instance_error", "instance_disconnected"];
/** Alerts an alert can turn into: when one of them is raised for the same subject, the first one did not recover. */
const SUCCESSORS: Partial<Record<Alert["code"], Alert["code"][]>> = {
  instance_stopped: INSTANCE_STATES,
  instance_error: INSTANCE_STATES,
  instance_disconnected: INSTANCE_STATES,
  challenge_limit: ["challenge_breached"],
  challenge_inactive: ["challenge_breached"],
};

/** How a gone alert went away, judged from the overview it is missing from. */
function resolutionOf(alert: Alert, overview: Overview): Resolution {
  if (alert.code.startsWith("instance_")) {
    if (!overview.instances.some((i) => i.name === alert.subject)) return "removed";
  } else if (!alert.code.startsWith("host_") && !overview.accounts.some((a) => a.number === alert.subject)) {
    return "removed";
  }
  const successors = SUCCESSORS[alert.code] ?? [];
  const turned = overview.alerts.some((a) => a.subject === alert.subject && successors.includes(a.code));
  return turned ? "resolved" : "recovered";
}

/** The market of the alert's instance, or of every instance of its account, is closed; unknown hours count as open. */
function marketClosed(alert: Alert, overview: Overview, now: Date): boolean {
  const instances = overview.instances.filter((i) =>
    alert.code.startsWith("instance_") ? i.name === alert.subject : i.account === alert.subject,
  );
  return instances.length > 0 && instances.every((i) => i.marketHours && !marketState(i.marketHours, now).open);
}

/**
 * Checks the alerts of the overview (default every 60 s) and posts the ones that are new or gone
 * to the webhook. Sent alerts are stored, so a restart neither repeats nor forgets them; a failed
 * post is retried on the next check. Webhook and heartbeat URLs may hold tokens: never logged.
 */
export class AlertNotifier {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  /** Since when an alert differs from what was posted (new, or gone); a restart starts anew. */
  private readonly pendingSince = new Map<string, number>();

  constructor(private readonly options: NotifierOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  /** Does nothing when neither URL is set. */
  start(): void {
    if (!this.options.webhookUrl && !this.options.heartbeatUrl) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(): Promise<void> {
    // A slow broker must not pile up checks.
    if (this.running) return;
    this.running = true;
    try {
      const overview = await this.options.load();
      if (this.options.webhookUrl) await this.notify(this.options.webhookUrl, overview);
      if (this.options.heartbeatUrl) await this.heartbeat(this.options.heartbeatUrl);
    } catch (error) {
      this.options.log.warn({ err: error }, "Alert check failed");
    } finally {
      this.running = false;
    }
  }

  private async notify(url: URL, overview: Overview): Promise<void> {
    const { db } = this.options;
    const sent = await db.selectFrom("notified_alerts").selectAll().execute();
    const current = new Map(overview.alerts.map((a) => [keyOf(a), a]));
    const sentKeys = new Set(sent.map((row) => row.key));
    const now = this.now();
    const time = now.toISOString();
    for (const key of this.pendingSince.keys()) {
      if (sentKeys.has(key) === current.has(key)) this.pendingSince.delete(key);
    }

    for (const [key, alert] of current) {
      if (sentKeys.has(key) || this.held(key, alert, overview, now)) continue;
      const text = alertText(alert, this.options.locale);
      if (!(await this.post(url, this.event("alert_raised", alert, time, text)))) continue;
      await db
        .insertInto("notified_alerts")
        .values({
          key,
          level: alert.level,
          code: alert.code,
          subject: alert.subject,
          params: JSON.stringify(alert.params),
          raised_at: time,
        })
        .execute();
      this.pendingSince.delete(key);
    }
    for (const row of sent) {
      if (current.has(row.key)) continue;
      if (now.getTime() - this.since(row.key, now) < (this.options.resolveDelayMs ?? 0)) continue;
      const alert = {
        level: row.level,
        code: row.code,
        subject: row.subject,
        params: JSON.parse(row.params) as Alert["params"],
      } as Alert;
      const text = alertText(alert, this.options.locale, resolutionOf(alert, overview));
      if (!(await this.post(url, this.event("alert_resolved", alert, time, text)))) continue;
      await db.deleteFrom("notified_alerts").where("key", "=", row.key).execute();
      this.pendingSince.delete(row.key);
    }
  }

  private since(key: string, now: Date): number {
    const since = this.pendingSince.get(key) ?? now.getTime();
    this.pendingSince.set(key, since);
    return since;
  }

  /**
   * A broker connection that may still come back by itself: not posted yet, and so no resolution either. Counted from
   * the alert's `since` where it has one (a lost connection is logged before the check sees it), else from when this
   * notifier first saw it.
   */
  private held(key: string, alert: Alert, overview: Overview, now: Date): boolean {
    if (!brokerConnection(alert)) return false;
    const since = typeof alert.params.since === "string" ? Date.parse(alert.params.since) : this.since(key, now);
    const grace = this.options.disconnectGraceMs ?? 0;
    const wait = marketClosed(alert, overview, now) ? (this.options.disconnectGraceClosedMs ?? grace) : grace;
    return now.getTime() - since < wait;
  }

  private event(event: AlertEvent["event"], alert: Alert, time: string, text: string): AlertEvent {
    // Host alerts are about the server itself, neither an instance nor an account.
    const about = alert.code.startsWith("instance_")
      ? { instance: alert.subject }
      : alert.code.startsWith("host_")
        ? {}
        : { account: alert.subject };
    return { event, time, ...alert, ...about, text, content: text };
  }

  private post(url: URL, body: AlertEvent): Promise<boolean> {
    return postJson({
      fetch: this.fetch,
      url,
      body,
      log: this.options.log,
      refused: "Alert webhook refused the notification",
      unreachable: "Alert webhook not reachable",
      context: { code: body.code },
    });
  }

  private async heartbeat(url: URL): Promise<void> {
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) this.options.log.warn({ status: response.status }, "Heartbeat URL refused the ping");
    } catch (error) {
      this.options.log.warn({ reason: (error as Error).name }, "Heartbeat URL not reachable");
    }
  }
}
