import type { Alert, Overview } from "@wickwatch/core";
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

const INSTANCE_STATES: Alert["code"][] = ["instance_stopped", "instance_error", "instance_disconnected"];
/** Alerts an alert can turn into: when one of them is raised for the same subject, the first one did not recover. */
const SUCCESSORS: Partial<Record<Alert["code"], Alert["code"][]>> = {
  instance_stopped: INSTANCE_STATES,
  instance_error: INSTANCE_STATES,
  instance_disconnected: INSTANCE_STATES,
  challenge_limit: ["challenge_breached"],
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
    const time = this.now().toISOString();

    for (const [key, alert] of current) {
      if (sent.some((row) => row.key === key)) continue;
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
    }
    for (const row of sent) {
      if (current.has(row.key)) continue;
      const alert = {
        level: row.level,
        code: row.code,
        subject: row.subject,
        params: JSON.parse(row.params) as Alert["params"],
      } as Alert;
      const text = alertText(alert, this.options.locale, resolutionOf(alert, overview));
      if (!(await this.post(url, this.event("alert_resolved", alert, time, text)))) continue;
      await db.deleteFrom("notified_alerts").where("key", "=", row.key).execute();
    }
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
