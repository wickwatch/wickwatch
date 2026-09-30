import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters";
import { buildApp, type App } from "../src/app";
import { loadConfig } from "../src/config";
import type { Database } from "../src/db";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp | undefined;
let bare: App | undefined;
afterEach(async () => {
  await t?.app.close();
  await bare?.close();
  t = bare = undefined;
});

async function start(env: Record<string, string> = {}) {
  t = await startApp(env);
  return t;
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
  it("answers /healthz without login", async () => {
    const res = await (await start()).app.inject("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "1.2.3" });
  });

  it("serves health at the root and under the base path, the API only under it", async () => {
    const { app } = await start({ BASE_PATH: "/bots" });
    const cookie = await loginAs(t!, "admin", "/bots");
    expect((await app.inject("/healthz")).statusCode).toBe(200);
    expect((await app.inject("/bots/healthz")).statusCode).toBe(200);
    expect((await app.inject({ url: "/bots/api/v1/system", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/system", headers: { cookie } })).statusCode).toBe(404);
  });

  it("reports 503 when the database is not reachable", async () => {
    const config = loadConfig({});
    const db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: () => Promise.reject(new Error("disk gone")) }),
    });
    bare = await buildApp({ config, db, adapters: createAdapters(config), version: "1.2.3", logger: false });
    const res = await bare.inject("/healthz");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "error" });
  });

  it("returns system info with adapter capabilities", async () => {
    const { app } = await start({ DEFAULT_LOCALE: "de" });
    const cookie = await loginAs(t!, "viewer");
    expect((await app.inject({ url: "/api/v1/system", headers: { cookie } })).json()).toMatchObject({
      version: "1.2.3",
      defaultLocale: "de",
      labelPrefix: "wickwatch",
      adapters: { runtime: "demo", broker: "demo", config: "demo" },
      capabilities: { emergencyStop: true },
    });
  });

  it("publishes the OpenAPI document and docs only after login", async () => {
    const { app } = await start({ BASE_PATH: "/bots" });
    expect((await app.inject("/bots/api/openapi.json")).statusCode).toBe(401);
    expect((await app.inject("/bots/api/docs/")).statusCode).toBe(401);
    expect((await app.inject("/bots/%61pi/openapi.json")).statusCode).toBe(401);
    expect((await app.inject("/bots/%61pi/docs/")).statusCode).toBe(401);

    const cookie = await loginAs(t!, "viewer", "/bots");
    const res = await app.inject({ url: "/bots/api/openapi.json", headers: { cookie } });
    const doc = res.json<{ openapi: string; servers: { url: string }[]; paths: Record<string, unknown> }>();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.servers).toEqual([{ url: "/bots" }]);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/healthz", "/api/v1/system", "/api/v1/auth/login", "/api/v1/accounts"]),
    );
    expect((await app.inject({ url: "/bots/api/docs/", headers: { cookie } })).statusCode).toBe(200);
  });

  it("serves the SPA with a base href, deep links and cached assets", async () => {
    const { app } = await start({ BASE_PATH: "/bots", WEB_DIST_DIR: webBuild() });

    expect((await app.inject("/bots")).headers.location).toBe("/bots/");
    const index = await app.inject("/bots/");
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<base href="/bots/" />');
    expect(index.headers["cache-control"]).toBe("no-cache");

    expect((await app.inject("/bots/login")).body).toContain('<base href="/bots/" />');

    const asset = await app.inject("/bots/assets/app.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");

    expect((await app.inject("/bots/assets/missing.js")).statusCode).toBe(404);
    expect((await app.inject("/elsewhere")).statusCode).toBe(404);
  });

  it("uses X-Forwarded-For only when TRUST_PROXY is set", async () => {
    const probe = async (env: Record<string, string>) => {
      const { app } = await startApp(env);
      app.get("/ip", (request) => ({ ip: request.ip }));
      const res = await app.inject({ url: "/ip", headers: { "x-forwarded-for": "203.0.113.9" } });
      await app.close();
      return res.json<{ ip: string }>().ip;
    };
    expect(await probe({ TRUST_PROXY: "true" })).toBe("203.0.113.9");
    expect(await probe({ TRUST_PROXY: "1" })).toBe("203.0.113.9");
    expect(await probe({})).not.toBe("203.0.113.9");
  });
});
