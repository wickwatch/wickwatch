import type { Alert, ApiToken, Overview, RuleResult } from "@wickwatch/core";
import de from "../../../../i18n/de.json" with { type: "json" };
import en from "../../../../i18n/en.json" with { type: "json" };
import type { Locale } from "../config";

// The same texts as the UI (i18n/*.json), so a notification reads like the alert on screen.
const MESSAGES: Record<Locale, unknown> = { en, de };

function lookup(locale: Locale, key: string): string | undefined {
  let node: unknown = MESSAGES[locale];
  for (const part of key.split(".")) {
    node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }
  return typeof node === "string" ? node : undefined;
}

const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));

/** Notifications have no viewer time zone: UTC, marked as such. */
function formatTime(locale: Locale, iso: string): string {
  const text = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(iso),
  );
  return `${text} UTC`;
}

/** A new API token as one line, for ALERT_WEBHOOK_URL. */
export function apiTokenCreatedText(locale: Locale, token: ApiToken): string {
  const t = (key: string) => lookup(locale, key) ?? lookup("en", key) ?? key;
  const params = { user: token.user, name: token.name, role: t(`profile.roles.${token.role}`) };
  return token.expiresAt
    ? fill(t("apiTokens.notice.created"), { ...params, expires: formatTime(locale, token.expiresAt) })
    : fill(t("apiTokens.notice.createdNoExpiry"), params);
}

/**
 * How an alert went away: `recovered` when the problem is gone (alerts with an own text say what is fine again, e.g.
 * "is running again"), `resolved` when it is gone without that being known (it turned into another alert), `removed`
 * when its instance or account no longer exists.
 */
export type Resolution = "recovered" | "resolved" | "removed";

/** The alert as one line of text, with its level in words: colour never carries meaning alone. */
export function alertText(alert: Alert, locale: Locale, resolution?: Resolution): string {
  const t = (key: string) => lookup(locale, key) ?? lookup("en", key) ?? key;
  const { reason, rule, since, last } = alert.params;
  const params = {
    ...alert.params,
    subject: alert.subject,
    ...(reason !== undefined ? { reason: t(`error.adapter.${String(reason)}`) } : {}),
    ...(rule !== undefined ? { rule: t(`challenge.rule.${String(rule)}`) } : {}),
    ...(since !== undefined ? { since: formatTime(locale, String(since)) } : {}),
    ...(last !== undefined ? { last: formatTime(locale, String(last)) } : {}),
  };
  if (resolution === "removed") {
    return fill(t(alert.code.startsWith("instance_") ? "alert.removed.instance" : "alert.removed.account"), params);
  }
  const key = `alert.recovered.${alert.code}`;
  const recovered = resolution === "recovered" ? (lookup(locale, key) ?? lookup("en", key)) : undefined;
  const message = fill(recovered ?? t(`alert.${alert.code}`), params);
  return resolution ? fill(t("alert.resolved"), { message }) : `${t(`alert.level.${alert.level}`)}: ${message}`;
}

const money = (locale: Locale, value: number, sign = false) =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...(sign ? { signDisplay: "exceptZero" as const } : {}),
  }).format(value);

function ruleText(rule: RuleResult, locale: Locale, t: (key: string) => string): string {
  const number = (value: number) =>
    rule.unit === "days"
      ? String(value)
      : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`;
  const value = rule.pending
    ? t("challenge.pending")
    : fill(t("challenge.ofValue"), { value: number(rule.value), limit: number(rule.limit) });
  return `${t(`challenge.rule.${rule.id}`)} ${value}`;
}

/**
 * The daily summary as plain text lines in the given locale: per account balance, equity, today's P&L (UTC day, as on
 * the dashboard), positions, instances and the challenge, then the number of open alerts.
 */
export function summaryText(overview: Overview, locale: Locale, day: string): string {
  const t = (key: string) => lookup(locale, key) ?? lookup("en", key) ?? key;
  const lines = [fill(t("summary.title"), { date: day })];
  for (const a of overview.accounts) {
    const name = a.displayName === a.number ? a.number : `${a.displayName} (${a.number})`;
    if (a.error || a.balance === undefined) {
      lines.push(fill(t("summary.accountError"), { name, reason: t(`error.adapter.${a.error ?? "unavailable"}`) }));
      continue;
    }
    const currency = a.currency ? ` ${a.currency}` : "";
    lines.push(
      fill(t("summary.account"), {
        name,
        balance: `${money(locale, a.balance)}${currency}`,
        equity: `${money(locale, a.equity ?? a.balance)}${currency}`,
        pnl: `${money(locale, a.dayPnl ?? 0, true)}${currency}`,
        positions: a.openPositions,
        running: a.instances.running,
        total: a.instances.total,
      }),
    );
    if (a.challenge) {
      const rules = a.challenge.rules.map((r) => ruleText(r, locale, t)).join(" · ");
      lines.push(
        fill(t("summary.challenge"), {
          status: t(`challenge.status.${a.challenge.status}`),
          day: a.challenge.day,
          rules,
        }),
      );
    }
  }
  if (!overview.accounts.length) lines.push(t("summary.noAccounts"));
  lines.push(
    overview.alerts.length ? fill(t("summary.alerts"), { count: overview.alerts.length }) : t("summary.noAlerts"),
  );
  return lines.join("\n");
}
