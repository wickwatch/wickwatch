import { isAbsolute, resolve } from "node:path";
import { DEFAULT_LABEL_PREFIX } from "@wickwatch/core";

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
  /** cTrader CLI executable for BROKER_ADAPTER=ctrader-cli. */
  ctraderCliPath: string;
  /** Directory with challenge templates (*.json). */
  challengeTemplatesDir: string;
  /** Where uploaded algo files are stored, versioned as <name>/<version>/<name>.algo. */
  algosDir: string;
  /** How often balance and equity of every account are sampled. */
  accountPollSeconds: number;
  webDistDir?: string;
  heartbeatUrl?: URL;
  alertWebhookUrl?: URL;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";

  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

/** Reads the configuration from environment variables; reports every problem at once. */
export function loadConfig(env: Record<string, string | undefined>, cwd = process.cwd()): Config {
  const problems: string[] = [];
  const get = (name: string) => {
    const value = env[name]?.trim();
    return value === "" ? undefined : value;
  };

  const port = Number(get("PORT") ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT must be an integer between 1 and 65535");

  const basePath = normaliseBasePath(get("BASE_PATH") ?? "/");
  if (basePath === undefined) problems.push("BASE_PATH must look like /bots (letters, digits, - _ . ~ and /)");

  const logLevel = get("LOG_LEVEL") ?? "info";
  if (!LOG_LEVELS.includes(logLevel)) problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);

  const masterKey = parseMasterKey(get("MASTER_KEY"), problems);
  const database = parseDatabaseUrl(get("DATABASE_URL") ?? "file:./data/wickwatch.db", cwd, problems);

  const labelPrefix = get("LABEL_PREFIX") ?? DEFAULT_LABEL_PREFIX;
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(labelPrefix)) {
    problems.push("LABEL_PREFIX must be lowercase letters and digits, separated by . or -");
  }

  const defaultLocale = get("DEFAULT_LOCALE") ?? "en";
  if (!isLocale(defaultLocale)) problems.push(`DEFAULT_LOCALE must be one of ${LOCALES.join(", ")}`);

  const heartbeatUrl = parseUrl("HEARTBEAT_URL", get("HEARTBEAT_URL"), problems);
  const alertWebhookUrl = parseUrl("ALERT_WEBHOOK_URL", get("ALERT_WEBHOOK_URL"), problems);
  const webDistDir = get("WEB_DIST_DIR");
  const dockerHost = get("DOCKER_HOST");
  const accountPollSeconds = Number(get("ACCOUNT_POLL_SECONDS") ?? 60);
  if (!Number.isInteger(accountPollSeconds) || accountPollSeconds < 10 || accountPollSeconds > 3600) {
    problems.push("ACCOUNT_POLL_SECONDS must be an integer between 10 and 3600");
  }
  if (dockerHost !== undefined && !/^(tcp|http|https|unix):\/\/.+/.test(dockerHost)) {
    problems.push("DOCKER_HOST must look like tcp://socket-proxy:2375 or unix:///var/run/docker.sock");
  }

  if (problems.length > 0 || basePath === undefined || !database || !isLocale(defaultLocale)) {
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
    ctraderCliPath: get("CTRADER_CLI_PATH") ?? "ctrader-cli",
    accountPollSeconds,
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
  };
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
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
