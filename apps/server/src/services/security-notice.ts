import type { ApiToken } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { Locale } from "../config";
import { apiTokenCreatedText } from "./alert-text";
import { postJson } from "./webhook";

/** What ALERT_WEBHOOK_URL receives when an API token is created, see docs/CONFIGURATION.md. */
export interface ApiTokenCreatedEvent {
  event: "api_token_created";
  time: string;
  /** The user who created it. */
  user: string;
  token: { id: number; name: string; role: ApiToken["role"]; expiresAt?: string };
  text: string;
  content: string;
}

export type SecurityNotifier = (token: ApiToken) => void;

/**
 * Tells ALERT_WEBHOOK_URL about new API tokens, so access nobody meant to give shows at once. Sent once, without
 * retry: the audit log keeps the record. The URL may hold a token: never logged.
 */
export function createSecurityNotifier(options: {
  webhookUrl: URL;
  locale: Locale;
  log: FastifyBaseLogger;
  fetch?: typeof fetch;
  now?: () => Date;
}): SecurityNotifier {
  const { webhookUrl, locale, log } = options;
  return (token) => {
    const text = apiTokenCreatedText(locale, token);
    const body: ApiTokenCreatedEvent = {
      event: "api_token_created",
      time: (options.now?.() ?? new Date()).toISOString(),
      user: token.user,
      token: {
        id: token.id,
        name: token.name,
        role: token.role,
        ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
      },
      text,
      content: text,
    };
    void postJson({
      fetch: options.fetch ?? fetch,
      url: webhookUrl,
      body,
      log,
      refused: "Alert webhook refused the API token notice",
      unreachable: "Alert webhook not reachable for the API token notice",
      context: { tokenId: token.id },
    });
  };
}
