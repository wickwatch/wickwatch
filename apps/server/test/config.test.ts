import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

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
      accountPollSeconds: 60,
    });
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
      }),
    ).toHaveLength(8);
  });

  it("explains that Postgres is not supported yet", () => {
    expect(problems({ DATABASE_URL: "postgresql://db/ww" })).toEqual([expect.stringContaining("not supported yet")]);
  });
});
