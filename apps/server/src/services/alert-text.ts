import type { Alert } from "@wickwatch/core";
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

/** The alert as one line of text, with its level in words: colour never carries meaning alone. */
export function alertText(alert: Alert, locale: Locale, resolved = false): string {
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
  const message = fill(t(`alert.${alert.code}`), params);
  return resolved ? fill(t("alert.resolved"), { message }) : `${t(`alert.level.${alert.level}`)}: ${message}`;
}
