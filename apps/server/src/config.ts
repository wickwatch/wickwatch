import { dirname, isAbsolute, resolve } from "node:path";
import { DEFAULT_LABEL_PREFIX, isTimeZone } from "@wickwatch/core";
import { readAdapterSettings, type AdapterSettings } from "./adapters";
import { ConfigError } from "./config-error";

/** Answers with `ts=<unix time>` in milliseconds; any URL whose answer has a Date header works too. */
const DEFAULT_CLOCK_CHECK_URL = "https://www.cloudflare.com/cdn-cgi/trace";
/** AGPL-3.0 §13: users of a changed version are offered its source; operators of one point SOURCE_URL at theirs. */
const DEFAULT_SOURCE_URL = "https://github.com/wickwatch/wickwatch";
const DEFAULT_SUPPORT_URL = "https://ko-fi.com/mmohrx";

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export interface Config {
  host: string;
  port: number;
  /** Normalised base path without trailing slash; empty string for the root. */
  basePath: string;
  /** Passed to Fastify's `trustProxy`: off, all, hop count or a list of addresses/CIDRs. */
  trustProxy: boolean | number | string[];
  logLevel: string;
  /** 32-byte key for encrypting stored credentials. */
  masterKey?: Buffer;
  database: { client: "sqlite"; filename: string };
  labelPrefix: string;
  defaultLocale: Locale;
  adapters: { runtime: string; broker: string; config: string };
  /** Docker API for the docker runtime adapter, e.g. tcp://socket-proxy:2375. */
  dockerHost?: string;
  /** Settings of the adapters themselves, by adapter id (adapters.ts). */
  adapterSettings: AdapterSettings;
  /** Docker restart policy of created instances. */
  instanceRestartPolicy: RestartPolicy;
  /** Directory with challenge templates (*.json). */
  challengeTemplatesDir: string;
  /** Where uploaded algo files are stored, one folder per algo name and version. */
  algosDir: string;
  /** How often balance and equity of every account are sampled. */
  accountPollSeconds: number;
  /** How often alerts are checked for ALERT_WEBHOOK_URL and HEARTBEAT_URL. */
  alertCheckSeconds: number;
  /** Database backups; `intervalHours` 0 turns them off. */
  backup: { dir: string; intervalHours: number; keep: number };
  /** Audit entries older than this are deleted; 0 keeps them forever. */
  auditRetentionDays: number;
  webDistDir?: string;
  heartbeatUrl?: URL;
  alertWebhookUrl?: URL;
  /** Time reference for the clock check; missing when switched off (`off`). */
  clockCheckUrl?: URL;
  /** Where the UI's footer links for the source code. */
  sourceUrl: URL;
  /** Where the UI's footer links to support the project; missing when switched off (`off`). */
  supportUrl?: URL;
  /** Once a day at this local time (HH:MM) a summary goes to the alert webhook; missing when off. */
  dailySummary?: { time: string; timeZone: string };
}

export const RESTART_POLICIES = ["on-failure", "unless-stopped", "no"] as const;
export type RestartPolicy = (typeof RESTART_POLICIES)[number];

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

/** Reads the configuration from environment variables; reports every problem at once. */
export function loadConfig(env: Record<string, string | undefined>, cwd = process.cwd()): Config {
  const problems: string[] = [];
  const get = (name: string) => {
    const value = env[name]?.trim();
    return value === "" ? undefined : value;
  };
  /** The value if it is in `list`; otherwise a problem "<name> must be one of …". */
  const oneOf = <T extends string>(name: string, fallback: T, list: readonly T[]): T => {
    const value = get(name) ?? fallback;
    if (!(list as readonly string[]).includes(value)) problems.push(`${name} must be one of ${list.join(", ")}`);
    // Not in the list only with a problem reported: loadConfig throws then.
    return value as T;
  };

  const port = Number(get("PORT") ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT must be an integer between 1 and 65535");

  const basePath = normaliseBasePath(get("BASE_PATH") ?? "/");
  if (basePath === undefined) problems.push("BASE_PATH must look like /bots (letters, digits, - _ . ~ and /)");

  const instanceRestartPolicy = oneOf("INSTANCE_RESTART_POLICY", "on-failure", RESTART_POLICIES);
  const logLevel = oneOf("LOG_LEVEL", "info", LOG_LEVELS);

  const masterKey = parseMasterKey(get("MASTER_KEY"), problems);
  const database = parseDatabaseUrl(get("DATABASE_URL") ?? "file:./data/wickwatch.db", cwd, problems);

  const labelPrefix = get("LABEL_PREFIX") ?? DEFAULT_LABEL_PREFIX;
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(labelPrefix)) {
    problems.push("LABEL_PREFIX must be lowercase letters and digits, separated by . or -");
  }

  const defaultLocale = oneOf("DEFAULT_LOCALE", "en", LOCALES);

  const heartbeatUrl = parseUrl("HEARTBEAT_URL", get("HEARTBEAT_URL"), problems);
  const alertWebhookUrl = parseUrl("ALERT_WEBHOOK_URL", get("ALERT_WEBHOOK_URL"), problems);
  const clockCheckSetting = get("CLOCK_CHECK_URL") ?? DEFAULT_CLOCK_CHECK_URL;
  const clockCheckUrl =
    clockCheckSetting.toLowerCase() === "off" ? undefined : parseUrl("CLOCK_CHECK_URL", clockCheckSetting, problems);
  const sourceUrl = parseUrl("SOURCE_URL", get("SOURCE_URL") ?? DEFAULT_SOURCE_URL, problems);
  const supportSetting = get("SUPPORT_URL") ?? DEFAULT_SUPPORT_URL;
  const supportUrl =
    supportSetting.toLowerCase() === "off" ? undefined : parseUrl("SUPPORT_URL", supportSetting, problems);
  const summaryTime = get("DAILY_SUMMARY_TIME");
  const summaryZone = get("DAILY_SUMMARY_TIMEZONE") ?? "UTC";
  if (summaryTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(summaryTime)) {
    problems.push("DAILY_SUMMARY_TIME must be a time of day like 21:30");
  }
  if (!isTimeZone(summaryZone)) problems.push("DAILY_SUMMARY_TIMEZONE must be an IANA time zone, e.g. Europe/Berlin");
  if (summaryTime !== undefined && !alertWebhookUrl) problems.push("DAILY_SUMMARY_TIME needs ALERT_WEBHOOK_URL");
  const webDistDir = get("WEB_DIST_DIR");
  const dockerHost = get("DOCKER_HOST");
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(get(name) ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${String(min)} and ${String(max)}`);
    }
    return value;
  };
  const accountPollSeconds = integer("ACCOUNT_POLL_SECONDS", 60, 10, 3600);
  const backupIntervalHours = integer("BACKUP_INTERVAL_HOURS", 24, 0, 24 * 30);
  const backupKeep = integer("BACKUP_KEEP", 7, 1, 1000);
  const auditRetentionDays = integer("AUDIT_RETENTION_DAYS", 365, 0, 36500);
  const adapterSettings = readAdapterSettings(get, problems);
  const alertCheckSeconds = integer("ALERT_CHECK_SECONDS", 60, 10, 3600);
  if (dockerHost !== undefined && !/^(tcp|http|https|unix):\/\/.+/.test(dockerHost)) {
    problems.push("DOCKER_HOST must look like tcp://socket-proxy:2375 or unix:///var/run/docker.sock");
  }

  if (problems.length > 0 || basePath === undefined || !database) {
    throw new ConfigError(problems);
  }

  return {
    host: get("HOST") ?? "0.0.0.0",
    port,
    basePath,
    trustProxy: parseTrustProxy(get("TRUST_PROXY")),
    logLevel,
    database,
    labelPrefix,
    defaultLocale,
    challengeTemplatesDir: resolve(cwd, get("CHALLENGE_TEMPLATES_DIR") ?? "templates/challenges"),
    algosDir: resolve(cwd, get("ALGOS_DIR") ?? "data/algos"),
    adapterSettings,
    instanceRestartPolicy,
    accountPollSeconds,
    alertCheckSeconds,
    backup: {
      // Next to the database by default, e.g. data/backups.
      dir: resolve(cwd, get("BACKUP_DIR") ?? resolve(dirname(database.filename), "backups")),
      intervalHours: database.filename === ":memory:" ? 0 : backupIntervalHours,
      keep: backupKeep,
    },
    auditRetentionDays,
    adapters: {
      runtime: get("RUNTIME_ADAPTER") ?? "demo",
      broker: get("BROKER_ADAPTER") ?? "demo",
      config: get("CONFIG_ADAPTER") ?? "demo",
    },
    ...(masterKey ? { masterKey } : {}),
    ...(webDistDir ? { webDistDir: resolve(cwd, webDistDir) } : {}),
    ...(dockerHost ? { dockerHost } : {}),
    ...(heartbeatUrl ? { heartbeatUrl } : {}),
    ...(alertWebhookUrl ? { alertWebhookUrl } : {}),
    ...(clockCheckUrl ? { clockCheckUrl } : {}),
    sourceUrl: sourceUrl ?? new URL(DEFAULT_SOURCE_URL),
    ...(supportUrl ? { supportUrl } : {}),
    ...(summaryTime !== undefined ? { dailySummary: { time: summaryTime, timeZone: summaryZone } } : {}),
  };
}

function normaliseBasePath(value: string): string | undefined {
  const path = `/${value}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return /^(\/[A-Za-z0-9._~-]+)*$/.test(path) ? path : undefined;
}

function parseTrustProxy(value: string | undefined): Config["trustProxy"] {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseMasterKey(value: string | undefined, problems: string[]): Buffer | undefined {
  if (value === undefined) return undefined;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    problems.push("MASTER_KEY must be 32 random bytes, base64-encoded (e.g. `openssl rand -base64 32`)");
    return undefined;
  }
  return key;
}

function parseDatabaseUrl(value: string, cwd: string, problems: string[]): Config["database"] | undefined {
  if (value.startsWith("file:")) {
    const path = value.slice("file:".length);
    if (path === "") {
      problems.push("DATABASE_URL needs a path, e.g. file:./data/wickwatch.db");
      return undefined;
    }
    const filename = path === ":memory:" || isAbsolute(path) ? path : resolve(cwd, path);
    return { client: "sqlite", filename };
  }
  if (/^postgres(ql)?:/.test(value)) {
    problems.push("DATABASE_URL: Postgres is planned but not supported yet; use file:./data/wickwatch.db");
  } else {
    problems.push("DATABASE_URL must start with file: (SQLite)");
  }
  return undefined;
}

function parseUrl(name: string, value: string | undefined, problems: string[]): URL | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {
    // reported below
  }
  problems.push(`${name} must be an http(s) URL`);
  return undefined;
}
