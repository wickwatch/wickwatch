import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters";
import { buildApp, type App } from "../src/app";
import { loadConfig } from "../src/config";
import { createDatabase, migrateToLatest, type Database } from "../src/db";

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(env: Record<string, string> = {}) {
  const config = loadConfig({ DATABASE_URL: "file::memory:", ...env });
  const db = createDatabase(config.database);
  await migrateToLatest(db);
  app = await buildApp({ config, db, adapters: createAdapters(config), version: "1.2.3", logger: false });
  return app;
}

function webBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), "wickwatch-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><html><head><title>Wickwatch</title></head><body></body></html>",
  );
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

describe("app", () => {
  it("answers /healthz", async () => {
    const res = await (await start()).inject("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "1.2.3" });
  });

  it("serves health at the root and under the base path", async () => {
    const server = await start({ BASE_PATH: "/bots" });
    expect((await server.inject("/healthz")).statusCode).toBe(200);
    expect((await server.inject("/bots/healthz")).statusCode).toBe(200);
    expect((await server.inject("/bots/api/v1/system")).statusCode).toBe(200);
    expect((await server.inject("/api/v1/system")).statusCode).toBe(404);
  });

  it("reports 503 when the database is not reachable", async () => {
    const config = loadConfig({});
    const db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: () => Promise.reject(new Error("disk gone")) }),
    });
    app = await buildApp({ config, db, adapters: createAdapters(config), version: "1.2.3", logger: false });
    const res = await app.inject("/healthz");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "error" });
  });

  it("returns system info with adapter capabilities", async () => {
    const res = await (await start({ DEFAULT_LOCALE: "de" })).inject("/api/v1/system");
    expect(res.json()).toMatchObject({
      version: "1.2.3",
      defaultLocale: "de",
      labelPrefix: "wickwatch",
      adapters: { runtime: "demo", broker: "demo", config: "demo" },
      capabilities: { emergencyStop: true },
    });
  });

  it("publishes an OpenAPI document relative to the base path", async () => {
    const res = await (await start({ BASE_PATH: "/bots" })).inject("/bots/api/openapi.json");
    const doc = res.json<{ openapi: string; servers: { url: string }[]; paths: Record<string, unknown> }>();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.servers).toEqual([{ url: "/bots" }]);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/healthz", "/api/v1/system"]));
    expect((await app!.inject("/bots/api/docs/")).statusCode).toBe(200);
  });

  it("serves the SPA with a base href, deep links and cached assets", async () => {
    const server = await start({ BASE_PATH: "/bots", WEB_DIST_DIR: webBuild() });

    expect((await server.inject("/bots")).headers.location).toBe("/bots/");
    const index = await server.inject("/bots/");
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<base href="/bots/" />');
    expect(index.headers["cache-control"]).toBe("no-cache");

    expect((await server.inject("/bots/instances/alpha")).body).toContain('<base href="/bots/" />');

    const asset = await server.inject("/bots/assets/app.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");

    expect((await server.inject("/bots/assets/missing.js")).statusCode).toBe(404);
    expect((await server.inject("/bots/api/v1/unknown")).json()).toEqual({ error: "not_found" });
    expect((await server.inject("/elsewhere")).statusCode).toBe(404);
  });

  it("uses X-Forwarded-For only when TRUST_PROXY is set", async () => {
    const probe = async (env: Record<string, string>) => {
      const server = await start(env);
      server.get("/ip", (request) => ({ ip: request.ip }));
      const res = await server.inject({ url: "/ip", headers: { "x-forwarded-for": "203.0.113.9" } });
      await server.close();
      app = undefined;
      return res.json<{ ip: string }>().ip;
    };
    expect(await probe({ TRUST_PROXY: "true" })).toBe("203.0.113.9");
    expect(await probe({ TRUST_PROXY: "1" })).toBe("203.0.113.9");
    expect(await probe({})).not.toBe("203.0.113.9");
  });
});
