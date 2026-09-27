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
        parameters: { EntryMode: "Pullback", RiskPercent: 0.5 },
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
    // Taken by a runtime instance that Wickwatch does not manage.
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
  });

  it("lists the broker's symbols and periods", async () => {
    const symbols = (await inject("GET", `/accounts/${String(accountId)}/symbols`)).json<string[]>();
    expect(symbols).toContain("GER40");
    expect((await inject("GET", "/system")).json<{ periods: string[] }>().periods).toContain("M5");
  });
});
