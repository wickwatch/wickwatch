import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptParameters, encryptStoredParameters } from "../src/services/instance-configs";
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
  alphaId = await uploadAlgo("alpha.algo", "alpha-v1");
});
afterEach(async () => {
  await t.app.close();
});

async function uploadAlgo(fileName: string, content: string, version = ""): Promise<number> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/algos?fileName=${fileName}${version ? `&version=${version}` : ""}`,
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    payload: Buffer.from(content),
  });
  return res.json<{ id: number }>().id;
}

const config = (overrides: Record<string, unknown> = {}) => ({
  algoId: alphaId,
  symbol: "GER40",
  period: "m5",
  parameters: { RiskPercent: 0.5, EntryMode: "Pullback" },
  attribution: { mode: "auto" },
  ...overrides,
});

const inject = (method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>, cookie = admin) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const create = (name: string, cfg = config(), account = accountId) =>
  inject("POST", "/managed-instances", { name, accountId: account, config: cfg });
const auditDetails = async (action: string) =>
  (await t.db.selectFrom("audit_log").select("details").where("action", "=", action).orderBy("id").execute()).map(
    (l) => JSON.parse(l.details ?? "{}") as unknown,
  );

interface Managed {
  name: string;
  account: { number: string };
  config: { version: number; algo: { id: number | null; name: string; version: string }; period: string };
  history?: { version: number; comment?: string; createdBy?: string }[];
}

describe("managed instances", () => {
  it("creates an instance with version 1 and normalises period and symbol", async () => {
    const res = await create("alpha-ger40-new", config({ symbol: "ger40" }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "alpha-ger40-new",
      account: { number: "1111111" },
      config: {
        version: 1,
        algo: { id: alphaId, name: "alpha", version: "1.5.0" },
        symbol: "GER40",
        period: "M5",
        parameters: {
          BotVersion: "1.5.0",
          EntryMode: "Pullback",
          RiskPercent: 0.5,
          SessionEnd: "17:30",
          SessionStart: "08:00",
          StopLossPoints: 40,
          TakeProfitPoints: 80,
          TrendPeriod: "H1",
          UseTrendFilter: true,
        },
        attribution: { mode: "auto" },
      },
    });
    const list = (await inject("GET", "/managed-instances")).json<Managed[]>();
    expect(list.map((i) => i.name)).toEqual(["alpha-ger40-new"]);
    const log = await t.db.selectFrom("audit_log").select(["action", "target"]).execute();
    expect(log).toContainEqual({ action: "instance.create", target: "alpha-ger40-new" });
  });

  it("rejects bad names, taken names, unknown symbols and periods", async () => {
    expect((await create("Alpha GER40")).statusCode).toBe(400);
    expect((await create("-alpha")).statusCode).toBe(400);
    // Taken by a runtime instance that wickwatch does not manage.
    expect((await create("alpha-ger40-a")).json()).toEqual({ error: "instance_exists" });
    expect((await create("x1")).statusCode).toBe(201);
    expect((await create("x1")).json()).toEqual({ error: "instance_exists" });
    expect((await create("x2", config({ symbol: "DAX" }))).json()).toEqual({ error: "invalid_symbol" });
    expect((await create("x2", config({ period: "m7" }))).json()).toEqual({ error: "invalid_period" });
    expect((await create("x2", config({ algoId: 999 }))).json()).toEqual({ error: "algo_not_found" });
    expect((await create("x2", config(), 999)).statusCode).toBe(404);
  });

  it("checks parameters against the algo metadata", async () => {
    const res = await create("x1", config({ parameters: { RiskPercent: 5, EntryMode: "Sideways", Nope: 1 } }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_parameters",
      issues: [
        { parameter: "RiskPercent", code: "above_max" },
        { parameter: "EntryMode", code: "invalid_option" },
      ],
      unknown: ["Nope"],
    });
    const pattern = config({ attribution: { mode: "label-pattern", orderLabel: "([" } });
    expect((await create("x1", pattern)).json()).toEqual({ error: "invalid_order_label" });
    expect((await create("x1", config({ attribution: { mode: "label-pattern" } }))).json()).toEqual({
      error: "invalid_order_label",
    });
  });

  it("keeps every save as a version; rollback is a new version", async () => {
    await create("x1");
    const v2 = await inject("POST", "/managed-instances/x1/configs", {
      ...config({ parameters: { RiskPercent: 1 } }),
      comment: "More risk",
    });
    expect(v2.statusCode).toBe(201);
    expect(v2.json<Managed>().config.version).toBe(2);
    expect(
      (await inject("POST", "/managed-instances/x1/configs", config({ parameters: { RiskPercent: 1 } }))).json(),
    ).toEqual({ error: "config_unchanged" });
    // Back to version 1.
    expect((await inject("POST", "/managed-instances/x1/configs", config())).json<Managed>().config.version).toBe(3);

    const detail = (await inject("GET", "/managed-instances/x1")).json<Managed>();
    expect(detail.history?.map((h) => h.version)).toEqual([3, 2, 1]);
    expect(detail.history?.[1]).toMatchObject({ comment: "More risk", createdBy: "admin-user" });
    expect((await inject("GET", "/managed-instances/nope")).statusCode).toBe(404);
  });

  it("switches algo versions and keeps old versions readable after the algo is gone", async () => {
    await create("x1");
    const newer = await uploadAlgo("alpha.algo", "alpha-v2", "1.6.0");
    await inject("POST", "/managed-instances/x1/configs", config({ algoId: newer }));
    // The current configuration needs its algo; the old one does not.
    expect((await inject("DELETE", `/algos/${String(newer)}`)).json()).toEqual({ error: "algo_in_use" });
    expect((await inject("DELETE", `/algos/${String(alphaId)}`)).statusCode).toBe(204);
    const detail = (await inject("GET", "/managed-instances/x1")).json<Managed & { history: Managed["config"][] }>();
    expect(detail.config.algo).toMatchObject({ id: newer, version: "1.6.0" });
    expect(detail.history[1]?.algo).toEqual({ id: null, name: "alpha", version: "1.5.0" });
  });

  it("deletes only with confirmation; accounts in use cannot be removed", async () => {
    await create("x1");
    expect((await inject("DELETE", `/accounts/${String(accountId)}`)).json()).toEqual({ error: "account_in_use" });
    expect((await inject("DELETE", "/managed-instances/x1", { confirm: "x2" })).statusCode).toBe(400);
    expect((await inject("DELETE", "/managed-instances/x9", { confirm: "x9" })).json()).toEqual({ error: "not_found" });
    expect((await inject("DELETE", "/managed-instances/x1", { confirm: "x1" })).statusCode).toBe(204);
    expect((await inject("GET", "/managed-instances")).json()).toEqual([]);
    expect(await t.db.selectFrom("instance_configs").select("id").execute()).toEqual([]);
    expect((await inject("DELETE", `/accounts/${String(accountId)}`)).statusCode).toBe(204);
  });

  it("lets viewers read but not change", async () => {
    await create("x1");
    const viewer = await loginAs(t, "viewer");
    expect((await inject("GET", "/managed-instances/x1", undefined, viewer)).statusCode).toBe(200);
    expect((await inject("POST", "/managed-instances/x1/configs", config(), viewer)).statusCode).toBe(403);
    expect(
      (await inject("POST", "/managed-instances", { name: "x9", accountId, config: config() }, viewer)).statusCode,
    ).toBe(403);
    expect((await inject("DELETE", "/managed-instances/x1", { confirm: "x1" }, viewer)).statusCode).toBe(403);
    // The admin check comes before the confirmation.
    expect((await inject("DELETE", "/managed-instances/x1", { confirm: "x2" }, viewer)).statusCode).toBe(403);
  });

  it("deploys the current version, replaces it on request and removes the container with the instance", async () => {
    await create("x1");
    const deploy = (body: Record<string, unknown>) => inject("POST", "/managed-instances/x1/deploy", body);
    expect((await deploy({ confirm: "nope" })).json()).toEqual({ error: "confirmation_required" });

    expect((await deploy({ confirm: "x1" })).json()).toEqual({ status: "stopped", configVersion: 1 });
    const overview = await inject("GET", "/overview");
    const runtime = overview
      .json<{ instances: { ref: string; name: string }[] }>()
      .instances.find((i) => i.ref === "x1");
    expect(runtime).toBeDefined();
    const detail = () =>
      inject("GET", "/managed-instances/x1").then((r) => r.json<Managed & { deployment?: unknown }>());
    expect((await detail()).deployment).toEqual({ status: "stopped", managed: true, configVersion: 1 });

    expect((await deploy({ confirm: "x1", start: true })).json()).toEqual({ status: "running", configVersion: 1 });
    await inject("POST", "/managed-instances/x1/configs", config({ parameters: { RiskPercent: 1 } }));
    expect((await detail()).deployment).toMatchObject({ configVersion: 1 });
    // Replacing keeps it running, now with version 2.
    expect((await deploy({ confirm: "x1" })).json()).toEqual({ status: "running", configVersion: 2 });

    const log = await t.db
      .selectFrom("audit_log")
      .select(["action", "details"])
      .where("action", "=", "instance.deploy")
      .execute();
    expect(log.map((l) => JSON.parse(l.details ?? "{}") as unknown)).toEqual([
      { ok: true, version: 1, replaced: false, started: false, image: "wickwatch-demo-runtime:1.0.0" },
      { ok: true, version: 1, replaced: true, started: true, image: "wickwatch-demo-runtime:1.0.0" },
      { ok: true, version: 2, replaced: true, started: false, image: "wickwatch-demo-runtime:1.0.0" },
    ]);

    // Removing stops the running instance.
    const list = vi.spyOn(t.adapters.runtime, "list");
    expect((await inject("DELETE", "/managed-instances/x1", { confirm: "x1" })).statusCode).toBe(204);
    expect(list).toHaveBeenCalledTimes(1);
    const after = (await inject("GET", "/overview")).json<{ instances: { ref: string }[] }>();
    expect(after.instances.some((i) => i.ref === "x1")).toBe(false);
    expect(await auditDetails("instance.delete")).toEqual([{ ok: true, versions: 2, containerRemoved: true }]);
  });

  it("audit-logs a failed deploy", async () => {
    await create("x1");
    vi.spyOn(t.adapters.runtime, "create").mockRejectedValue(new AdapterError("unavailable", "proxy down"));
    expect((await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1" })).json()).toEqual({
      error: "unavailable",
    });
    expect(await auditDetails("instance.deploy")).toEqual([{ ok: false, error: "unavailable" }]);
  });

  it("shows parameter values to admins only", async () => {
    await create("x1");
    const viewer = await loginAs(t, "viewer");
    const params = (m: { config: { parameters: object } }) => m.config.parameters;
    expect(params((await inject("GET", "/managed-instances/x1")).json())).toMatchObject({
      RiskPercent: 0.5,
      EntryMode: "Pullback",
    });
    const detail = (await inject("GET", "/managed-instances/x1", undefined, viewer)).json<{
      config: { parameters: object };
      history: { parameters: object }[];
    }>();
    expect(params(detail)).toEqual({});
    expect(detail.history.map((h) => h.parameters)).toEqual([{}]);
    const list = (await inject("GET", "/managed-instances", undefined, viewer)).json<
      { config: { parameters: object } }[]
    >();
    expect(list.map(params)).toEqual([{}]);
  });

  it("keeps the instance when the runtime cannot be asked whether a container must go", async () => {
    await create("x1");
    await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1" });
    vi.spyOn(t.adapters.runtime, "list").mockRejectedValue(new AdapterError("unavailable", "proxy down"));
    expect((await inject("DELETE", "/managed-instances/x1", { confirm: "x1" })).statusCode).toBe(503);
    vi.restoreAllMocks();
    expect((await inject("GET", "/managed-instances/x1")).statusCode).toBe(200);
    expect(await auditDetails("instance.delete")).toEqual([{ ok: false, error: "unavailable" }]);
  });

  it("never takes over a container of the same name defined elsewhere", async () => {
    await create("x1");
    // Simulate a compose container that appeared later under the same name.
    await t.db.updateTable("instances").set({ name: "alpha-ger40-a" }).where("name", "=", "x1").execute();
    const res = await inject("POST", "/managed-instances/alpha-ger40-a/deploy", { confirm: "alpha-ger40-a" });
    expect(res.json()).toEqual({ error: "instance_exists" });
    expect((await inject("DELETE", "/managed-instances/alpha-ger40-a", { confirm: "alpha-ger40-a" })).statusCode).toBe(
      204,
    );
    const overview = (await inject("GET", "/overview")).json<{ instances: { ref: string }[] }>();
    expect(overview.instances.some((i) => i.ref === "alpha-ger40-a")).toBe(true);
  });

  it("stores parameter values encrypted and still finds unchanged versions", async () => {
    await create("x1");
    const [row] = await t.db.selectFrom("instance_configs").select("parameters").execute();
    expect(row?.parameters).toMatch(/^v1\./);
    expect(row?.parameters).not.toContain("Pullback");
    expect(JSON.parse(t.cipher.decrypt(row?.parameters ?? "", "instance-parameters"))).toMatchObject({
      EntryMode: "Pullback",
      RiskPercent: 0.5,
    });
    // Compared on the decrypted values, although every encryption differs.
    expect((await inject("POST", "/managed-instances/x1/configs", config())).json()).toEqual({
      error: "config_unchanged",
    });
  });

  it("reads plaintext parameter values of earlier versions and encrypts them at start", async () => {
    await create("x1");
    const before = (await inject("GET", "/managed-instances/x1")).json<Managed>();
    const [row] = await t.db.selectFrom("instance_configs").select(["id", "parameters"]).execute();
    const plaintext = t.cipher.decrypt(row?.parameters ?? "", "instance-parameters");
    await t.db.updateTable("instance_configs").set({ parameters: plaintext }).execute();
    expect((await inject("GET", "/managed-instances/x1")).json()).toEqual(before);
    // Without MASTER_KEY: plaintext stays readable, encrypted values are left out.
    expect(decryptParameters(undefined, plaintext)).toBe(plaintext);
    expect(decryptParameters(undefined, row?.parameters ?? "")).toBeUndefined();

    expect(await encryptStoredParameters(t.db, t.cipher)).toBe(1);
    expect(await encryptStoredParameters(t.db, t.cipher)).toBe(0);
    const [after] = await t.db.selectFrom("instance_configs").select("parameters").execute();
    expect(after?.parameters).toMatch(/^v1\./);
    expect(t.cipher.decrypt(after?.parameters ?? "", "instance-parameters")).toBe(plaintext);
    expect((await inject("GET", "/managed-instances/x1")).json()).toEqual(before);
  });

  it("lists the broker's symbols and periods", async () => {
    const symbols = (await inject("GET", `/accounts/${String(accountId)}/symbols`)).json<string[]>();
    expect(symbols).toContain("GER40");
    expect((await inject("GET", "/system")).json<{ periods: string[] }>().periods).toContain("M5");
  });
});

describe("parameter files", () => {
  beforeEach(async () => {
    await t.app.close();
    t = await startApp({ ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")), CONFIG_ADAPTER: "cbotset" });
    admin = await loginAs(t, "admin");
    alphaId = await uploadAlgo("alpha.algo", "alpha-v1");
  });

  const readFile = (content: string, cookie = admin) =>
    t.app.inject({
      method: "POST",
      url: `/api/v1/algos/${String(alphaId)}/parameter-file`,
      headers: { cookie, "content-type": "application/octet-stream" },
      payload: Buffer.from(content),
    });

  it("reads a .cbotset for an algo without storing anything", async () => {
    const file = `\uFEFF${JSON.stringify({
      Chart: { Symbol: "GER40", Period: "m15" },
      Parameters: { RiskPercent: "0.8", EntryMode: 1, Unknown: 1 },
    })}`;
    const res = await readFile(file);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      values: { RiskPercent: 0.8, EntryMode: "Pullback" },
      symbol: "GER40",
      period: "m15",
      issues: [],
      unknown: ["Unknown"],
    });
    expect((await readFile("not json")).json()).toEqual({ error: "parameter_file_invalid" });
    const viewer = await loginAs(t, "viewer");
    expect((await readFile(file, viewer)).statusCode).toBe(403);
  });

  it("downloads a configuration version as .cbotset, enums as numbers, for admins only", async () => {
    expect((await create("alpha-file")).statusCode).toBe(201);
    const res = await inject("GET", "/managed-instances/alpha-file/parameter-file?version=1");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="alpha-file-v1.cbotset"');
    const file = JSON.parse(res.body.replace(/^\uFEFF/, "")) as { Chart: unknown; Parameters: Record<string, unknown> };
    expect(file.Chart).toEqual({ Symbol: "GER40", Period: "M5" });
    expect(file.Parameters).toMatchObject({ RiskPercent: 0.5, EntryMode: 1 });

    expect((await inject("GET", "/managed-instances/alpha-file/parameter-file?version=9")).statusCode).toBe(404);
    const viewer = await loginAs(t, "viewer");
    expect((await inject("GET", "/managed-instances/alpha-file/parameter-file", undefined, viewer)).statusCode).toBe(
      403,
    );
  });
});

describe("account size check", () => {
  const sizeOf = async (number: string) =>
    (await inject("GET", "/accounts"))
      .json<{ number: string; accountSize?: unknown }[]>()
      .find((a) => a.number === number)?.accountSize;
  const dayStart = (day: string, balance: number | null) =>
    t.db.insertInto("daily_stats").values({ account_id: accountId, day, start_balance: balance }).execute();

  beforeEach(async () => {
    await t.db.deleteFrom("daily_stats").execute();
  });

  it("takes the challenge's start balance, else the latest recorded day-start balance, from the database", async () => {
    expect(await sizeOf("1111111")).toBeUndefined();
    await dayStart("2026-09-30", 9900);
    await dayStart("2026-10-01", 9800);
    await dayStart("2026-10-02", null);
    expect(await sizeOf("1111111")).toEqual({ value: 9800, basis: "dayStart" });

    const now = new Date().toISOString();
    const profile = { name: "Trial", startDate: "2026-09-01", startBalance: 10_000, rules: {} };
    await t.db
      .insertInto("challenge_profiles")
      .values({ account_id: accountId, profile: JSON.stringify(profile), created_at: now, updated_at: now })
      .execute();
    expect(await sizeOf("1111111")).toEqual({ value: 10_000, basis: "challengeStart" });
  });

  it("gives an instance's detail the parameter and size to check it with, once the algo names one", async () => {
    await create("alpha-ger40-size");
    await dayStart("2026-10-01", 10_000);
    const detail = async () =>
      (await inject("GET", "/managed-instances/alpha-ger40-size")).json<{ accountSizeCheck?: unknown }>();
    expect((await detail()).accountSizeCheck).toBeUndefined();

    await t.app.inject({
      method: "PUT",
      url: "/api/v1/algo-settings/alpha",
      headers: { cookie: admin },
      payload: { accountSizeParameter: "RiskPercent" },
    });
    expect((await detail()).accountSizeCheck).toEqual({
      parameter: "RiskPercent",
      reference: { value: 10_000, basis: "dayStart" },
    });
  });
});
