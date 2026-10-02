import type { FastifyBaseLogger } from "fastify";

export const REQUEST_TIMEOUT_MS = 10_000;

/** The Telegram Bot API takes formatted text; every other receiver gets the plain text as it is. */
const isTelegram = (url: URL) => url.hostname === "api.telegram.org" && url.pathname.endsWith("/sendMessage");

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Long numbers on their own (account numbers, ids), not amounts like 10,000.00 or dates. */
const LONG_NUMBER = /(?<![\d.,])\d{5,}(?![\d.,])/g;

/**
 * The text as Telegram HTML: escaped, long numbers as code (Telegram would turn an account number into a phone link),
 * and in a text of several paragraphs the first line of each in bold (title, account names).
 */
export function telegramHtml(text: string): string {
  const line = (l: string) => escapeHtml(l).replace(LONG_NUMBER, "<code>$&</code>");
  const paragraphs = text.split("\n\n");
  return paragraphs
    .map((paragraph) => {
      const [first = "", ...rest] = paragraph.split("\n");
      const head = paragraphs.length > 1 ? `<b>${line(first)}</b>` : line(first);
      return [head, ...rest.map(line)].join("\n");
    })
    .join("\n\n");
}

/** What goes to the receiver: for Telegram the text as HTML. */
function forReceiver(url: URL, body: unknown): unknown {
  if (!isTelegram(url) || typeof body !== "object" || body === null) return body;
  const { text } = body as { text?: unknown };
  return typeof text === "string" ? { ...body, text: telegramHtml(text), parse_mode: "HTML" } : body;
}

/**
 * POSTs `body` as JSON; true if the receiver took it. Otherwise logs a warning (`refused` or `unreachable`) with
 * `context`, never the URL: it may hold a token.
 */
export async function postJson(opts: {
  fetch: typeof fetch;
  url: URL;
  body: unknown;
  log: FastifyBaseLogger;
  refused: string;
  unreachable: string;
  context?: Record<string, unknown>;
}): Promise<boolean> {
  const { log, context } = opts;
  try {
    const response = await opts.fetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(forReceiver(opts.url, opts.body)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return true;
    log.warn({ status: response.status, ...context }, opts.refused);
  } catch (error) {
    log.warn({ reason: (error as Error).name, ...context }, opts.unreachable);
  }
  return false;
}
