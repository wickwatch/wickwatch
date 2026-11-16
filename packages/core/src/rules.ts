// Input rules shared by the server and the dashboard. Dependency-free, so the SPA can import them at runtime
// (`@wickwatch/core/rules`) without pulling in the rest of the core.

import type { LogRule } from "./schemas/algo";
import type { RuleId } from "./schemas/challenge";
import type { InstanceStatus, LogFilter, LogLine } from "./schemas/runtime";
import type { InstancePause } from "./schemas/schedule";

export { ATTRIBUTION_MODES } from "./attribution";
export { DEFAULT_LABEL_PREFIX } from "./labels";

/** Shortest password accepted for a login. */
export const MIN_PASSWORD_LENGTH = 12;

/** Lifetimes offered for a new API token, in days; the server accepts any number up to the last one. */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

/**
 * Instance names: lower case, digits and dashes, usable as a container name and host name. Also the default order
 * label. Use `.source` where a JSON Schema pattern is needed.
 */
export const INSTANCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Algo names and versions end up in folder names and paths; keep them to safe characters. */
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Challenge rules reported by an alert of their own (the days without a trade): they get no bar on the account and no
 * line in the daily summary, and do not make the challenge "near a limit". A breach still counts like any other.
 */
export const isAlertOnlyRule = (id: RuleId): boolean => id === "inactivity";

/** Running, or about to run again: counts as meant to run. */
export const isUp = (status: InstanceStatus | undefined): boolean => status === "running" || status === "restarting";

/** A schedule's pause shows only while the instance is not up: one started by hand during the pause just runs. */
export const shownPause = (status: InstanceStatus, pause: InstancePause | undefined): InstancePause | undefined =>
  isUp(status) ? undefined : pause;

/** Whether a log filter keeps a line: problems are warnings and errors, setups the lines with setup features. */
export const keepsLogLine = (line: Pick<LogLine, "level" | "setup">, filter: LogFilter): boolean =>
  filter === "problems" ? line.level === "warn" || line.level === "error" : filter === "setups" ? !!line.setup : true;

/**
 * Tests a log line against a log rule's pattern or its recovery pattern: contained text in any case, or a regular
 * expression (case-insensitive too). Throws for a regular expression that does not compile.
 */
export function logRuleMatchers(rule: Pick<LogRule, "pattern" | "regex" | "recoveryPattern">): {
  matches: (text: string) => boolean;
  recovers: (text: string) => boolean;
} {
  const matcher = (pattern: string | undefined): ((text: string) => boolean) => {
    if (pattern === undefined) return () => false;
    if (rule.regex) {
      const expression = new RegExp(pattern, "i");
      return (text) => expression.test(text);
    }
    const needle = pattern.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  };
  return { matches: matcher(rule.pattern), recovers: matcher(rule.recoveryPattern) };
}

/**
 * An image reference split into repository and tag: `ghcr.io/org/app:1.2.3` → `ghcr.io/org/app` and `1.2.3`. A
 * reference by digest (`…@sha256:…`) or without a tag has no tag. A port in the registry host is no tag.
 */
export function splitImage(image: string): { repository: string; tag?: string } {
  const at = image.indexOf("@");
  if (at >= 0) return { repository: image.slice(0, at) };
  const colon = image.lastIndexOf(":");
  if (colon < 0 || colon < image.lastIndexOf("/")) return { repository: image };
  return { repository: image.slice(0, colon), tag: image.slice(colon + 1) };
}

/** A stable version tag as numbers: `5.10.6` or `v0.8.7`; undefined for others, e.g. `5.10.5-alpha` or `latest`. */
export function stableVersion(tag: string): number[] | undefined {
  const match = /^v?(\d+(?:\.\d+){0,3})$/.exec(tag);
  return match?.[1]?.split(".").map(Number);
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The stable version tags among `tags`, newest first. */
export function stableVersions(tags: readonly string[]): string[] {
  return tags
    .flatMap((tag) => {
      const version = stableVersion(tag);
      return version ? [{ tag, version }] : [];
    })
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((v) => v.tag);
}

/** The newest stable tag among `tags` if it is newer than `current`; undefined when `current` is no stable version. */
export function newerVersion(current: string, tags: readonly string[]): string | undefined {
  const own = stableVersion(current);
  const [latest] = stableVersions(tags);
  const version = latest === undefined ? undefined : stableVersion(latest);
  return own && version && compareVersions(version, own) > 0 ? latest : undefined;
}
