import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let accountId: number;
let algosDir: string;

const inject = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, cookie = admin) =>
  t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function upload(
  fileName: string,
  content: string,
  query = "",
): Promise<{ id: number; name: string; version: string }> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/algos?fileName=${fileName}${query}`,
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    payload: Buffer.from(content),
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

beforeEach(async () => {
  algosDir = mkdtempSync(join(tmpdir(), "ww-algos-"));
  t = await startApp({ ALGOS_DIR: algosDir });
  admin = await loginAs(t, "admin");
  accountId = (await t.db.selectFrom("accounts").select("id").where("number", "=", "1111111").executeTakeFirstOrThrow())
    .id;
});
afterEach(async () => {
  await t.app.close();
});

describe("algo families", () => {
  it("files an upload as a version of another algo, and still starts it by its own name", async () => {
    const alpha = await upload("alpha.algo", "alpha-v1", "&version=1.5.0");
    const filed = await upload("beta.algo", "beta-v1", "&algo=alpha&version=2.0.0");
    expect(filed).toMatchObject({ name: "alpha", version: "2.0.0" });
    expect((await inject("GET", `/managed-instances/algo-update?algoId=${String(filed.id)}`)).statusCode).toBe(200);

    const created = await inject("POST", "/managed-instances", {
      name: "x1",
      accountId,
      config: { algoId: filed.id, symbol: "GER40", period: "m5", parameters: {}, attribution: { mode: "auto" } },
    });
    expect(created.statusCode).toBe(201);
    // Filed as "alpha", the platform must still start it by its own name "beta".
    const launch = vi.spyOn(t.adapters.broker, "launch");
    expect((await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1" })).statusCode).toBe(200);
    expect(launch.mock.calls[0]?.[0].algo.name).toBe("beta");
    expect(alpha.name).toBe("alpha");
  });

  it("moves a version to another name with its configurations, templates and settings", async () => {
    const viewer = await loginAs(t, "viewer");
    const old = await upload("alpha.algo", "alpha-v1", "&version=1.5.0");
    const created = await inject("POST", "/managed-instances", {
      name: "x1",
      accountId,
      config: { algoId: old.id, symbol: "GER40", period: "m5", parameters: {}, attribution: { mode: "auto" } },
    });
    expect(created.statusCode).toBe(201);
    expect((await inject("PUT", "/algo-settings/alpha", { riskParameter: "RiskPercent" })).statusCode).toBe(200);
    for (const [algoName, name] of [
      ["alpha", "Calm"],
      ["alpha", "Shared"],
    ]) {
      expect((await inject("POST", "/parameter-templates", { algoName, name, parameters: {} })).statusCode).toBe(201);
    }
    // The family already has a template "Shared" and settings of its own? Here: a template only.
    const family = await upload("beta.algo", "beta-v1", "&algo=Family&version=v2");
    // The family has templates of the same names already.
    for (const name of ["Shared", "Shared (alpha)"]) {
      expect(
        (await inject("POST", "/parameter-templates", { algoName: "Family", name, parameters: {} })).statusCode,
      ).toBe(201);
    }

    expect((await inject("PATCH", `/algos/${String(old.id)}`, { name: "Family" }, viewer)).statusCode).toBe(403);
    expect((await inject("PATCH", `/algos/${String(old.id)}`, { name: "Family", version: "v2" })).json()).toEqual({
      error: "algo_version_exists",
    });
    const moved = await inject("PATCH", `/algos/${String(old.id)}`, { name: "Family", version: "v1" });
    expect(moved.json()).toMatchObject({ id: old.id, name: "Family", version: "v1" });

    const detail = (await inject("GET", "/managed-instances/x1")).json<{
      config: { algo: unknown };
      history: { algo: unknown }[];
      riskCheck?: unknown;
    }>();
    expect(detail.config.algo).toEqual({ id: old.id, name: "Family", version: "v1" });
    const templates = (await inject("GET", "/parameter-templates?algo=Family")).json<{ name: string }[]>();
    expect(templates.map((tpl) => tpl.name).sort()).toEqual(["Calm", "Shared", "Shared (alpha 2)", "Shared (alpha)"]);
    const settings = (await inject("GET", "/algo-settings")).json<{ algoName: string }[]>();
    expect(settings.map((s) => s.algoName)).toEqual(["Family"]);

    // The file moved along: a new upload of the old name and version does not touch it.
    expect(existsSync(join(algosDir, "alpha", "1.5.0"))).toBe(false);
    expect(readFileSync(join(algosDir, "Family", "v1", "alpha.algo"), "utf8")).toBe("alpha-v1");
    await upload("alpha.algo", "alpha-other", "&version=1.5.0");
    expect(readFileSync(join(algosDir, "Family", "v1", "alpha.algo"), "utf8")).toBe("alpha-v1");
    expect((await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1" })).statusCode).toBe(200);

    // Now one algo: the instance on v1 can move to v2.
    const preview = (await inject("GET", `/managed-instances/algo-update?algoId=${String(family.id)}`)).json<{
      instances: { name: string }[];
    }>();
    expect(preview.instances.map((i) => i.name)).toEqual(["x1"]);

    const log = await t.db
      .selectFrom("audit_log")
      .select(["target", "details"])
      .where("action", "=", "algo.update")
      .execute();
    expect(log).toEqual([
      {
        target: "Family v1",
        details: JSON.stringify({ from: "alpha 1.5.0", templates: 2, settings: true }),
      },
    ]);
  });
});
