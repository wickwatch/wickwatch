import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let accountId: number;
let alphaId: number;
beforeEach(async () => {
  t = await startApp({ ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")) });
  admin = await loginAs(t, "admin");
  accountId = (await t.db.selectFrom("accounts").select("id").where("number", "=", "1111111").executeTakeFirstOrThrow())
    .id;
  const upload = await t.app.inject({
    method: "POST",
    url: "/api/v1/algos?fileName=alpha.algo",
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    payload: Buffer.from("alpha-v1"),
  });
  alphaId = upload.json<{ id: number }>().id;
});
afterEach(async () => {
  await t.app.close();
});

const inject = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  cookie = admin,
) => t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

const template = (overrides: Record<string, unknown> = {}) => ({
  algoName: "alpha",
  name: "Conservative",
  parameters: { RiskPercent: 0.3, LicenceKey: "placeholder-key" },
  source: { kind: "instance", instance: "alpha-ger40", version: 3 },
  ...overrides,
});
const create = (body = template()) => inject("POST", "/parameter-templates", body);
const auditRows = (action: string) =>
  t.db.selectFrom("audit_log").select(["user_id", "target", "details"]).where("action", "=", action).execute();

interface Template {
  id: number;
  name: string;
  parameters: Record<string, unknown>;
  count: number;
  createdBy?: string;
}

describe("parameter templates", () => {
  it("saves a template, encrypted at rest, and lists it with its values for admins", async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      algoName: "alpha",
      name: "Conservative",
      parameters: { RiskPercent: 0.3, LicenceKey: "placeholder-key" },
      count: 2,
      source: { kind: "instance", instance: "alpha-ger40", version: 3 },
    });

    const stored = await t.db.selectFrom("parameter_templates").select("parameters").executeTakeFirstOrThrow();
    expect(stored.parameters).not.toContain("placeholder-key");

    const list = (await inject("GET", "/parameter-templates?algo=alpha")).json<Template[]>();
    expect(list).toHaveLength(1);
    expect(list[0]?.parameters).toEqual({ LicenceKey: "placeholder-key", RiskPercent: 0.3 });
    expect((await inject("GET", "/parameter-templates?algo=beta")).json()).toEqual([]);

    const one = await inject("GET", `/parameter-templates/${String(list[0]?.id)}`);
    expect(one.json()).toMatchObject({ name: "Conservative", parameters: { RiskPercent: 0.3 } });
    expect((await inject("GET", "/parameter-templates/999")).statusCode).toBe(404);
  });

  it("gives viewers the names and counts but no values, and lets them change nothing", async () => {
    const id = (await create()).json<Template>().id;
    const viewer = await loginAs(t, "viewer");
    const list = (await inject("GET", "/parameter-templates", undefined, viewer)).json<Template[]>();
    expect(list[0]).toMatchObject({ name: "Conservative", parameters: {}, count: 2 });
    expect((await inject("GET", `/parameter-templates/${String(id)}`, undefined, viewer)).json()).toMatchObject({
      parameters: {},
      count: 2,
    });
    expect((await inject("POST", "/parameter-templates", template({ name: "x" }), viewer)).statusCode).toBe(403);
    expect((await inject("PATCH", `/parameter-templates/${String(id)}`, { name: "y" }, viewer)).statusCode).toBe(403);
    expect((await inject("DELETE", `/parameter-templates/${String(id)}`, undefined, viewer)).statusCode).toBe(403);
  });

  it("needs a known algo and a name not used for it yet", async () => {
    expect((await create(template({ algoName: "unknown" }))).json()).toEqual({ error: "algo_not_found" });
    await create();
    const again = await create(template({ name: " Conservative " }));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "parameter_template_exists" });
  });

  it("renames a template and replaces its values", async () => {
    const id = (await create()).json<Template>().id;
    await create(template({ name: "Aggressive" }));
    const url = `/parameter-templates/${String(id)}`;
    expect((await inject("PATCH", url, { name: "Aggressive" })).statusCode).toBe(409);

    const renamed = await inject("PATCH", url, { name: "Calm" });
    expect(renamed.json()).toMatchObject({ name: "Calm", count: 2 });
    const replaced = await inject("PATCH", url, { parameters: { RiskPercent: 0.2 } });
    // New values without a source drop the old one: it would name the wrong origin.
    expect(replaced.json()).toMatchObject({ name: "Calm", parameters: { RiskPercent: 0.2 }, count: 1 });
    expect(replaced.json()).not.toHaveProperty("source");

    const details = (await auditRows("parameter_template.update")).map((r) => JSON.parse(r.details ?? "{}") as unknown);
    expect(details).toEqual([
      { algo: "alpha", renamedFrom: "Conservative" },
      { algo: "alpha", parameters: 1 },
    ]);
  });

  it("deletes a template and audits who did it", async () => {
    const id = (await create()).json<Template>().id;
    expect((await inject("DELETE", `/parameter-templates/${String(id)}`)).statusCode).toBe(204);
    expect((await inject("DELETE", `/parameter-templates/${String(id)}`)).statusCode).toBe(404);
    const [entry] = await auditRows("parameter_template.delete");
    expect(entry).toMatchObject({ target: "Conservative" });
    expect(entry?.user_id).not.toBeNull();
  });

  it("names the template a configuration was saved from in the audit log", async () => {
    const id = (await create(template({ parameters: { RiskPercent: 1 } }))).json<Template>().id;
    const config = {
      algoId: alphaId,
      symbol: "GER40",
      period: "m5",
      parameters: { RiskPercent: 0.5 },
      attribution: { mode: "auto" },
    };
    const created = await inject("POST", "/managed-instances", {
      name: "alpha-ger40",
      accountId,
      config: { ...config, template: id },
    });
    expect(created.statusCode).toBe(201);
    const saved = await inject("POST", "/managed-instances/alpha-ger40/configs", {
      ...config,
      parameters: { RiskPercent: 1 },
      template: id,
    });
    expect(saved.statusCode).toBe(201);
    const missing = await inject("POST", "/managed-instances/alpha-ger40/configs", { ...config, template: id + 1 });
    expect(missing.json()).toEqual({ error: "parameter_template_not_found" });

    const [creation] = await auditRows("instance.create");
    const [change] = await auditRows("instance.config");
    expect(JSON.parse(creation?.details ?? "{}")).toMatchObject({ template: "Conservative" });
    expect(JSON.parse(change?.details ?? "{}")).toMatchObject({ version: 2, template: "Conservative" });
  });

  it("refuses a template of another algo for a configuration", async () => {
    await t.app.inject({
      method: "POST",
      url: "/api/v1/algos?fileName=beta.algo",
      headers: { cookie: admin, "content-type": "application/octet-stream" },
      payload: Buffer.from("beta-v1"),
    });
    const algos = (await inject("GET", "/algos")).json<{ id: number; name: string }[]>();
    const other = algos.find((a) => a.id !== alphaId);
    if (!other) throw new Error("second algo missing");
    const id = (await create(template({ algoName: other.name }))).json<Template>().id;
    const res = await inject("POST", "/managed-instances", {
      name: "alpha-ger40",
      accountId,
      config: {
        algoId: alphaId,
        symbol: "GER40",
        period: "m5",
        parameters: {},
        attribution: { mode: "auto" },
        template: id,
      },
    });
    expect(res.json()).toEqual({ error: "parameter_template_not_found" });
  });
});
