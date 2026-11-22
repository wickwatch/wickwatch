import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError, type AlgoMetadata } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
let accountId: number;
let oldId: number;
let newId: number;

const inject = (method: "GET" | "POST", url: string, payload?: Record<string, unknown>, cookie = admin) =>
  t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

async function uploadAlgo(content: string, version: string): Promise<number> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/algos?fileName=alpha.algo&version=${version}`,
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    payload: Buffer.from(content),
  });
  return res.json<{ id: number }>().id;
}

/** The new version: BotVersion follows, UseTrendFilter goes, Filter comes, Pullback is no longer an entry mode. */
async function changeNewSchema(): Promise<void> {
  const row = await t.db.selectFrom("algos").select("metadata").where("id", "=", newId).executeTakeFirstOrThrow();
  const metadata = JSON.parse(row.metadata) as AlgoMetadata;
  metadata.parameters = metadata.parameters
    .filter((p) => p.name !== "UseTrendFilter")
    .map((p) => {
      if (p.name === "BotVersion") return { ...p, default: "1.6.0" };
      if (p.name === "EntryMode") return { ...p, options: ["Breakout", "Momentum"] };
      return p;
    });
  metadata.parameters.push({ name: "Filter", type: "bool", default: true });
  await t.db
    .updateTable("algos")
    .set({ metadata: JSON.stringify(metadata) })
    .where("id", "=", newId)
    .execute();
}

async function createInstance(name: string, symbol: string, parameters: Record<string, unknown>) {
  const res = await inject("POST", "/managed-instances", {
    name,
    accountId,
    config: { algoId: oldId, symbol, period: "m5", parameters, attribution: { mode: "auto" } },
  });
  expect(res.statusCode).toBe(201);
}

const detail = async (name: string) =>
  (await inject("GET", `/managed-instances/${name}`)).json<{
    config: {
      version: number;
      symbol: string;
      comment?: string;
      algo: { id: number };
      parameters: Record<string, unknown>;
    };
    deployment?: { configVersion?: number };
  }>();

beforeEach(async () => {
  t = await startApp({ ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")) });
  admin = await loginAs(t, "admin");
  accountId = (await t.db.selectFrom("accounts").select("id").where("number", "=", "1111111").executeTakeFirstOrThrow())
    .id;
  oldId = await uploadAlgo("alpha-v1", "1.5.0");
  await createInstance("x1", "GER40", { RiskPercent: 0.8, EntryMode: "Pullback" });
  await createInstance("x2", "US30", {});
  newId = await uploadAlgo("alpha-v2", "1.6.0");
  await changeNewSchema();
});
afterEach(async () => {
  vi.useRealTimers();
  await t.app.close();
});

/** The symbols are cached for an hour since creating the instances; past that, saving asks the broker again. */
function expireSymbolCache(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 61 * 60 * 1000);
}

describe("moving instances to another algo version", () => {
  it("previews for admins what each instance would get", async () => {
    const viewer = await loginAs(t, "viewer");
    expect(
      (await inject("GET", `/managed-instances/algo-update?algoId=${String(newId)}`, undefined, viewer)).statusCode,
    ).toBe(403);
    expect((await inject("GET", "/managed-instances/algo-update?algoId=999")).json()).toEqual({
      error: "algo_not_found",
    });

    const preview = (await inject("GET", `/managed-instances/algo-update?algoId=${String(newId)}`)).json<{
      algo: unknown;
      instances: { name: string }[];
    }>();
    expect(preview.algo).toEqual({ id: newId, name: "alpha", version: "1.6.0" });
    expect(preview.instances).toEqual([
      {
        name: "x1",
        account: expect.objectContaining({ number: "1111111" }) as unknown,
        from: { id: oldId, version: "1.5.0" },
        configVersion: 1,
        deployed: false,
        added: ["Filter"],
        dropped: ["UseTrendFilter"],
        newDefaults: [{ parameter: "BotVersion", from: "1.5.0", to: "1.6.0" }],
        rejected: [{ parameter: "EntryMode", code: "invalid_option" }],
        issues: [],
      },
      expect.objectContaining({ name: "x2", rejected: [] }),
    ]);
    // Instances already on the version are no candidates.
    expect(
      (await inject("GET", `/managed-instances/algo-update?algoId=${String(oldId)}`)).json<{ instances: unknown[] }>()
        .instances,
    ).toEqual([]);
  });

  it("saves a configuration version per instance with the carried-over values", async () => {
    const viewer = await loginAs(t, "viewer");
    const body = { algoId: newId, instances: ["x1", "x2", "x1", "nope"], comment: " Update to 1.6.0 " };
    expect((await inject("POST", "/managed-instances/algo-update", body, viewer)).statusCode).toBe(403);

    const res = await inject("POST", "/managed-instances/algo-update", body);
    expect(res.json()).toEqual({ saved: ["x1", "x2"], failed: [{ name: "nope", error: "instance_not_found" }] });
    const x1 = (await detail("x1")).config;
    expect(x1).toMatchObject({ version: 2, symbol: "GER40", comment: "Update to 1.6.0", algo: { id: newId } });
    expect(x1.parameters).toMatchObject({ RiskPercent: 0.8, EntryMode: "Breakout", BotVersion: "1.6.0", Filter: true });
    expect(x1.parameters).not.toHaveProperty("UseTrendFilter");
    expect((await detail("x2")).config.version).toBe(2);

    const audits = await t.db
      .selectFrom("audit_log")
      .select(["target", "details", "user_id"])
      .where("action", "=", "instance.config")
      .execute();
    expect(audits.map((a) => a.target)).toEqual(["x1", "x2"]);
    expect(audits.every((a) => a.user_id !== null)).toBe(true);

    // Done once; again, they are on it already.
    expect(
      (await inject("POST", "/managed-instances/algo-update", { algoId: newId, instances: ["x1"] })).json(),
    ).toEqual({
      saved: [],
      failed: [{ name: "x1", error: "config_unchanged" }],
    });
  });

  it("leaves out an instance whose values still need a manual edit", async () => {
    const row = await t.db.selectFrom("algos").select("metadata").where("id", "=", newId).executeTakeFirstOrThrow();
    const metadata = JSON.parse(row.metadata) as AlgoMetadata;
    // Out of range whatever the instance has: no default to fall back on.
    metadata.parameters.push({ name: "Lots", type: "int", min: 1, default: 0 });
    await t.db
      .updateTable("algos")
      .set({ metadata: JSON.stringify(metadata) })
      .where("id", "=", newId)
      .execute();

    const preview = (await inject("GET", `/managed-instances/algo-update?algoId=${String(newId)}`)).json<{
      instances: { issues: unknown[] }[];
    }>();
    expect(preview.instances[0]?.issues).toEqual([{ parameter: "Lots", code: "below_min" }]);
    expect(
      (await inject("POST", "/managed-instances/algo-update", { algoId: newId, instances: ["x1"] })).json(),
    ).toEqual({
      saved: [],
      failed: [{ name: "x1", error: "parameters_incomplete" }],
    });
    expect((await detail("x1")).config.version).toBe(1);
  });

  it("deploys the deployed ones afterwards on request, leaving those with an open position alone", async () => {
    for (const name of ["x1", "x2"]) {
      expect((await inject("POST", `/managed-instances/${name}/deploy`, { confirm: name })).statusCode).toBe(200);
    }
    await createInstance("x3", "GER40", {});
    const real = t.app.overview.overview.bind(t.app.overview);
    // The rollout waits for the overview: held until the test lets it go.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(t.app.overview, "overview").mockImplementation(async (...args) => {
      await held;
      const loaded = await real(...args);
      return {
        ...loaded,
        instances: loaded.instances.map((i) => (i.name === "x1" ? { ...i, openPositions: 1 } : i)),
      };
    });

    const body = { algoId: newId, instances: ["x1", "x2", "x3"], deploy: true };
    expect((await inject("POST", "/managed-instances/algo-update", body)).json()).toEqual({
      error: "confirmation_required",
    });
    // Nothing saved without the confirmation.
    expect((await detail("x1")).config.version).toBe(1);

    const res = await inject("POST", "/managed-instances/algo-update", { ...body, confirm: "all" });
    // x3 never ran in a container: saved, not deployed.
    expect(res.json()).toMatchObject({
      saved: ["x1", "x2", "x3"],
      failed: [],
      rollout: { algo: { id: newId }, running: true, pending: ["x1", "x2"] },
    });
    // One rollout at a time, whatever kind.
    expect((await inject("POST", "/managed-instances/update-images", { confirm: "all" })).json()).toEqual({
      error: "update_running",
    });
    expect((await inject("POST", "/managed-instances/algo-update", { ...body, confirm: "all" })).json()).toEqual({
      error: "update_running",
    });
    release();

    const progress = async () =>
      (await inject("GET", "/managed-instances/algo-rollout")).json<{
        rollout?: { running: boolean; updated: string[]; skipped: { name: string; reason: string }[] };
      }>().rollout;
    await vi.waitFor(async () => {
      expect((await progress())?.running).toBe(false);
    });
    expect(await progress()).toMatchObject({ updated: ["x2"], skipped: [{ name: "x1", reason: "open_position" }] });
    expect((await detail("x2")).deployment?.configVersion).toBe(2);
    expect((await detail("x1")).deployment?.configVersion).toBe(1);

    const [entry] = await t.db
      .selectFrom("audit_log")
      .select(["target", "details"])
      .where("action", "=", "instance.update_algo")
      .execute();
    expect(entry).toEqual({
      target: "alpha 1.6.0",
      details: JSON.stringify({ updated: ["x2"], skipped: ["x1: open_position"] }),
    });
  });

  it("goes on with the other instances when one fails, and reports it", async () => {
    // The broker does not answer when asked for the symbols again.
    const symbols = vi
      .spyOn(t.adapters.broker, "symbols")
      .mockRejectedValue(new AdapterError("timeout", "The broker did not answer"));
    expireSymbolCache();
    const res = await inject("POST", "/managed-instances/algo-update", { algoId: newId, instances: ["x1", "x2"] });
    symbols.mockRestore();
    const body = res.json<{ saved: string[]; failed: { name: string; error: string }[] }>();
    expect(res.statusCode).toBe(200);
    expect([...body.saved, ...body.failed.map((f) => f.name)].sort()).toEqual(["x1", "x2"]);
    expect(body.failed.every((f) => f.error === "timeout")).toBe(true);
  });

  it("holds the rollout slot while it saves, so no other rollout starts in between", async () => {
    expect((await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1" })).statusCode).toBe(200);
    // Saving waits for the broker's symbols; meanwhile "update all" must be refused.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const real = t.adapters.broker.symbols.bind(t.adapters.broker);
    const asked = vi.spyOn(t.adapters.broker, "symbols").mockImplementation(async (...args) => {
      await held;
      return real(...args);
    });
    expireSymbolCache();
    const saving = inject("POST", "/managed-instances/algo-update", {
      algoId: newId,
      instances: ["x1"],
      deploy: true,
      confirm: "all",
    });
    await vi.waitFor(() => {
      expect(asked).toHaveBeenCalled();
    });
    expect((await inject("POST", "/managed-instances/update-images", { confirm: "all" })).json()).toEqual({
      error: "update_running",
    });
    release();
    expect((await saving).json()).toMatchObject({ saved: ["x1"] });
  });
});
