import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters";
import { loadConfig } from "../src/config";
import { refreshAlgoMetadata } from "../src/services/algo-metadata";
import { loginAs, MASTER_KEY, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let algosDir: string;
beforeEach(async () => {
  algosDir = mkdtempSync(join(tmpdir(), "ww-algos-"));
  t = await startApp({ ALGOS_DIR: algosDir });
  admin = await loginAs(t, "admin");
});
afterEach(async () => {
  await t.app.close();
});

const upload = (fileName: string, content: string, query = "", cookie = admin) =>
  t.app.inject({
    method: "POST",
    url: `/api/v1/algos?fileName=${encodeURIComponent(fileName)}${query}`,
    headers: { cookie, "content-type": "application/octet-stream" },
    payload: Buffer.from(content),
  });

interface AlgoBody {
  id: number;
  name: string;
  version: string;
  sha256: string;
  fullAccess: boolean;
  parameters: { name: string }[];
}

describe("algos", () => {
  it("stores an upload versioned, with hash and parameters from the metadata", async () => {
    const res = await upload("alpha.algo", "binary-v1");
    expect(res.statusCode).toBe(201);
    const algo = res.json<AlgoBody>();
    // The demo bot's BotVersion default is 1.5.0.
    expect(algo).toMatchObject({ name: "alpha", version: "1.5.0", fullAccess: false });
    expect(algo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(algo.parameters.map((p) => p.name)).toContain("RiskPercent");
    expect(existsSync(join(algosDir, "alpha", "1.5.0", "alpha.algo"))).toBe(true);
    expect(existsSync(join(algosDir, ".incoming"))).toBe(true);

    const list = (await t.app.inject({ url: "/api/v1/algos", headers: { cookie: admin } })).json<AlgoBody[]>();
    expect(list.map((a) => `${a.name} ${a.version}`)).toEqual(["alpha 1.5.0"]);
  });

  it("takes an explicit version and rejects duplicates", async () => {
    expect((await upload("alpha.algo", "v1")).statusCode).toBe(201);
    const sameVersion = await upload("alpha.algo", "v2");
    expect(sameVersion.json()).toEqual({ error: "algo_version_exists" });
    expect((await upload("alpha.algo", "v2", "&version=1.6.0")).json<AlgoBody>().version).toBe("1.6.0");
    const sameFile = await upload("alpha.algo", "v2", "&version=1.7.0");
    expect(sameFile.statusCode).toBe(409);
    expect(sameFile.json()).toMatchObject({ error: "algo_duplicate", message: "alpha 1.6.0" });
  });

  it("rejects files without readable metadata and leaves nothing behind", async () => {
    const res = await upload("unknown.algo", "junk");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "algo_unreadable" });
    expect((await t.db.selectFrom("algos").select("id").execute()).length).toBe(0);
    expect((await upload("empty.algo", "")).statusCode).toBe(400);
  });

  it("deletes a version with its file, admin only", async () => {
    const { id } = (await upload("beta.algo", "b")).json<AlgoBody>();
    const viewer = await loginAs(t, "viewer");
    expect((await t.app.inject({ url: "/api/v1/algos", headers: { cookie: viewer } })).statusCode).toBe(200);
    expect((await upload("alpha.algo", "x", "", viewer)).statusCode).toBe(403);
    expect(
      (await t.app.inject({ method: "DELETE", url: `/api/v1/algos/${String(id)}`, headers: { cookie: viewer } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await t.app.inject({ method: "DELETE", url: `/api/v1/algos/${String(id)}`, headers: { cookie: admin } }))
        .statusCode,
    ).toBe(204);
    expect(existsSync(join(algosDir, "beta", "2.1.0"))).toBe(false);
    const actions = await t.db.selectFrom("audit_log").select("action").where("action", "like", "algo.%").execute();
    expect(actions.map((a) => a.action)).toEqual(["algo.upload", "algo.delete"]);
  });

  it("reads algos again once whose metadata came from an older reader", async () => {
    const { id } = (await upload("alpha.algo", "binary-v1")).json<AlgoBody>();
    expect((await t.db.selectFrom("algos").select("metadata_reader").executeTakeFirstOrThrow()).metadata_reader).toBe(
      "demo:1",
    );
    // As stored by an older reader: fewer parameters, no reader recorded.
    await t.db
      .updateTable("algos")
      .set({ metadata: JSON.stringify({ name: "alpha", parameters: [] }), metadata_reader: null })
      .where("id", "=", id)
      .execute();
    const broker = createAdapters(loadConfig({ DATABASE_URL: "file::memory:", MASTER_KEY })).broker;
    const refresh = () => refreshAlgoMetadata({ db: t.db, broker, algosDir, log: t.app.log });

    expect(await refresh()).toEqual({ refreshed: 1, failed: 0 });
    const list = (await t.app.inject({ url: "/api/v1/algos", headers: { cookie: admin } })).json<AlgoBody[]>();
    expect(list[0]?.parameters.map((p) => p.name)).toContain("RiskPercent");
    // Name and version stay; nothing left to do on the next start.
    expect(list[0]).toMatchObject({ name: "alpha", version: "1.5.0" });
    expect(await refresh()).toEqual({ refreshed: 0, failed: 0 });
  });

  it("keeps the metadata of an algo that cannot be read and tries again later", async () => {
    await upload("alpha.algo", "binary-v1");
    await t.db.updateTable("algos").set({ metadata_reader: "demo:0" }).execute();
    rmSync(join(algosDir, "alpha"), { recursive: true });
    const broker = createAdapters(loadConfig({ DATABASE_URL: "file::memory:", MASTER_KEY })).broker;
    const refresh = () => refreshAlgoMetadata({ db: t.db, broker, algosDir, log: t.app.log });
    expect(await refresh()).toEqual({ refreshed: 0, failed: 1 });
    const row = await t.db.selectFrom("algos").select(["metadata", "metadata_reader"]).executeTakeFirstOrThrow();
    expect(row.metadata_reader).toBe("demo:0");
    expect(row.metadata).toContain("RiskPercent");
  });
});

describe("algo settings", () => {
  const settings = (method: "GET" | "PUT", name = "", payload?: object, cookie = admin) =>
    t.app.inject({
      method,
      url: `/api/v1/algo-settings${name ? `/${encodeURIComponent(name)}` : ""}`,
      headers: { cookie },
      ...(payload ? { payload } : {}),
    });

  it("names the account size and risk parameters of an algo, for all its versions, and audits it", async () => {
    await upload("alpha.algo", "binary-v1");
    expect((await settings("GET")).json()).toEqual([]);
    // The demo algo has no starting capital; any number parameter does for the test.
    const saved = await settings("PUT", "alpha", { accountSizeParameter: "StopLossPoints" });
    expect(saved.json()).toEqual({ algoName: "alpha", accountSizeParameter: "StopLossPoints" });
    // Fields left out stay as they are.
    expect((await settings("PUT", "alpha", { riskParameter: "RiskPercent" })).json()).toEqual({
      algoName: "alpha",
      accountSizeParameter: "StopLossPoints",
      riskParameter: "RiskPercent",
    });
    expect((await settings("GET")).json()).toEqual([
      { algoName: "alpha", accountSizeParameter: "StopLossPoints", riskParameter: "RiskPercent" },
    ]);

    expect((await settings("PUT", "alpha", { accountSizeParameter: null })).json()).toEqual({
      algoName: "alpha",
      riskParameter: "RiskPercent",
    });
    const rows = await t.db
      .selectFrom("audit_log")
      .select(["user_id", "target", "details"])
      .where("action", "=", "algo.settings")
      .execute();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      target: "alpha",
      details: JSON.stringify({ accountSizeParameter: "StopLossPoints", riskParameter: null }),
    });
    expect(rows[0]?.user_id).not.toBeNull();
  });

  it("takes only number parameters of the newest version, but keeps a saved one it no longer has", async () => {
    await upload("alpha.algo", "binary-v1");
    for (const parameter of ["Unknown", "SessionEnd"]) {
      const res = await settings("PUT", "alpha", { riskParameter: parameter });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "setting_parameter_invalid" });
    }
    await t.db
      .insertInto("algo_settings")
      .values({
        algo_name: "alpha",
        account_size_parameter: "Gone",
        risk_parameter: null,
        updated_by: null,
        updated_at: "2026-10-03T00:00:00.000Z",
      })
      .execute();
    expect(
      (await settings("PUT", "alpha", { accountSizeParameter: "Gone", riskParameter: "RiskPercent" })).statusCode,
    ).toBe(200);
  });

  it("needs a known algo and an admin", async () => {
    expect((await settings("PUT", "unknown", { accountSizeParameter: "RiskPercent" })).json()).toEqual({
      error: "algo_not_found",
    });
    await upload("alpha.algo", "binary-v1");
    const viewer = await loginAs(t, "viewer");
    expect((await settings("PUT", "alpha", { accountSizeParameter: "RiskPercent" }, viewer)).statusCode).toBe(403);
    expect((await settings("GET", "", undefined, viewer)).statusCode).toBe(200);
  });
});
