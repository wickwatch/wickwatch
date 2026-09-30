import type { FastifyBaseLogger } from "fastify";

export const REQUEST_TIMEOUT_MS = 10_000;

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
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return true;
    log.warn({ status: response.status, ...context }, opts.refused);
  } catch (error) {
    log.warn({ reason: (error as Error).name, ...context }, opts.unreachable);
  }
  return false;
}
