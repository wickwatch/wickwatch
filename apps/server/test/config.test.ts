import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ConfigError } from "../src/config-error";

const load = (env: Record<string, string>) => loadConfig(env, "/srv/wickwatch");

function problems(env: Record<string, string>): string[] {
  try {
    load(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("loadConfig", () => {
  it("has working defaults", () => {
    expect(load({})).toEqual({
      host: "0.0.0.0",
      port: 3000,
      basePath: "",
      trustProxy: false,
      logLevel: "info",
      database: { client: "sqlite", filename: "/srv/wickwatch/data/wickwatch.db" },
      labelPrefix: "wickwatch",
      defaultLocale: "en",
      adapters: { runtime: "demo", broker: "demo", config: "demo" },
      challengeTemplatesDir: "/srv/wickwatch/templates/challenges",
      algosDir: "/srv/wickwatch/data/algos",
      accountPollSeconds: 60,
      alertCheckSeconds: 60,
      backup: { dir: "/srv/wickwatch/data/backups", intervalHours: 24, keep: 7 },
      auditRetentionDays: 365,
      adapterSettings: { "ctrader-cli": { cli: "local", cliPath: "ctrader-cli" } },
      instanceRestartPolicy: "on-failure",
      clockCheckUrl: new URL("https://www.cloudflare.com/cdn-cgi/trace"),
      sourceUrl: new URL("https://github.com/wickwatch/wickwatch"),
      supportUrl: new URL("https://ko-fi.com/mmohrx"),
      mcp: true,
      apiTokensRequire2fa: false,
    });
  });

  it("switches the clock check off and checks the daily summary settings", () => {
    expect(load({ CLOCK_CHECK_URL: "off" }).clockCheckUrl).toBeUndefined();
    expect(() => load({ CLOCK_CHECK_URL: "ntp.example" })).toThrow(/CLOCK_CHECK_URL/);
    expect(load({}).sourceUrl.href).toBe("https://github.com/wickwatch/wickwatch");
    expect(load({ SOURCE_URL: "https://git.example/fork" }).sourceUrl.href).toBe("https://git.example/fork");
    expect(load({}).supportUrl?.href).toBe("https://ko-fi.com/mmohrx");
    expect(load({ SUPPORT_URL: "off" }).supportUrl).toBeUndefined();
    expect(() => load({ SUPPORT_URL: "ko-fi" })).toThrow(/SUPPORT_URL/);
    expect(load({ MCP: "OFF" }).mcp).toBe(false);
    expect(() => load({ MCP: "no" })).toThrow(/MCP must be on or off/);
    expect(load({ API_TOKENS_REQUIRE_2FA: "ON" }).apiTokensRequire2fa).toBe(true);
    expect(() => load({ API_TOKENS_REQUIRE_2FA: "yes" })).toThrow(/API_TOKENS_REQUIRE_2FA must be on or off/);
    const webhook = { ALERT_WEBHOOK_URL: "https://hooks.example/x" };
    expect(
      load({ ...webhook, DAILY_SUMMARY_TIME: "21:30", DAILY_SUMMARY_TIMEZONE: "Europe/Berlin" }).dailySummary,
    ).toEqual({
      time: "21:30",
      timeZone: "Europe/Berlin",
    });
    expect(load({ ...webhook, DAILY_SUMMARY_TIME: "07:00" }).dailySummary).toEqual({ time: "07:00", timeZone: "UTC" });
    expect(() => load({ ...webhook, DAILY_SUMMARY_TIME: "7:00" })).toThrow(/DAILY_SUMMARY_TIME/);
    expect(() => load({ ...webhook, DAILY_SUMMARY_TIME: "07:00", DAILY_SUMMARY_TIMEZONE: "Mars" })).toThrow(
      /DAILY_SUMMARY_TIMEZONE/,
    );
    expect(() => load({ DAILY_SUMMARY_TIME: "07:00" })).toThrow(/needs ALERT_WEBHOOK_URL/);
  });

  it("requires a pinned cTrader image and a known restart policy", () => {
    const image = (env: Record<string, string>) => load(env).adapterSettings["ctrader-cli"].image;
    expect(image({ CTRADER_IMAGE: "ghcr.io/spotware/ctrader-console:5.9.11" })).toBe(
      "ghcr.io/spotware/ctrader-console:5.9.11",
    );
    expect(() => load({ CTRADER_IMAGE: "ghcr.io/spotware/ctrader-console:latest" })).toThrow(/pinned/);
    expect(() => load({ CTRADER_IMAGE: "ghcr.io/spotware/ctrader-console" })).toThrow(/pinned/);
    expect(() => load({ CTRADER_IMAGE: "registry.local:5000/ctrader-console" })).toThrow(/pinned/);
    expect(image({ CTRADER_IMAGE: "registry.local:5000/ctrader-console:5.9.11" })).toMatch(/5\.9\.11$/);
    expect(image({ CTRADER_IMAGE: `ghcr.io/spotware/ctrader-console@sha256:${"a".repeat(64)}` })).toMatch(/@sha256/);
    expect(() => load({ INSTANCE_RESTART_POLICY: "always" })).toThrow(/INSTANCE_RESTART_POLICY/);
  });

  it("treats empty values like unset ones, as in .env.example", () => {
    expect(load({ MASTER_KEY: "", HEARTBEAT_URL: "", PORT: "" }).port).toBe(3000);
  });

  it.each([
    ["/", ""],
    ["bots", "/bots"],
    ["/bots/", "/bots"],
    ["//tools//bots", "/tools/bots"],
  ])("normalises BASE_PATH %j to %j", (input, expected) => {
    expect(load({ BASE_PATH: input }).basePath).toBe(expected);
  });

  it.each([
    ["true", true],
    ["false", false],
    ["2", 2],
    ["10.0.0.0/8, 172.16.0.1", ["10.0.0.0/8", "172.16.0.1"]],
  ])("parses TRUST_PROXY %j", (input, expected) => {
    expect(load({ TRUST_PROXY: input }).trustProxy).toEqual(expected);
  });

  it("decodes a 32-byte master key", () => {
    const key = Buffer.alloc(32, 7);
    expect(load({ MASTER_KEY: key.toString("base64") }).masterKey).toEqual(key);
  });

  it("keeps absolute and in-memory database paths", () => {
    expect(load({ DATABASE_URL: "file:/var/lib/ww.db" }).database.filename).toBe("/var/lib/ww.db");
    expect(load({ DATABASE_URL: "file::memory:" }).database.filename).toBe(":memory:");
  });

  it("reports every problem at once", () => {
    expect(
      problems({
        PORT: "70000",
        BASE_PATH: "/bad path",
        MASTER_KEY: "c2hvcnQ=",
        DATABASE_URL: "postgres://localhost/ww",
        LABEL_PREFIX: "Bad_Prefix",
        DEFAULT_LOCALE: "fr",
        HEARTBEAT_URL: "ftp://example.com",
        LOG_LEVEL: "loud",
        ALERT_CHECK_SECONDS: "5",
        CTRADER_CLI: "docker",
      }),
    ).toHaveLength(10);
  });

  it("explains that Postgres is not supported yet", () => {
    expect(problems({ DATABASE_URL: "postgresql://db/ww" })).toEqual([expect.stringContaining("not supported yet")]);
  });
});
