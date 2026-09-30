import { isObject } from "./json";

/** Prefix of structured setup log lines, see docs/BOT-CONTRACT.md. */
export const SETUP_LOG_PREFIX = "WW-SETUP";

/** Returns the JSON payload of a `WW-SETUP {...}` line, or undefined for any other line. */
export function parseSetupLine(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf(`${SETUP_LOG_PREFIX} {`);
  if (start === -1) return undefined;
  try {
    const payload: unknown = JSON.parse(text.slice(start + SETUP_LOG_PREFIX.length + 1));
    return isObject(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}
