import { Value } from "typebox/value";
import { Overview, type EmergencyStopReport } from "@wickwatch/core";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters";
import { buildApp, type App } from "../src/app";
import { loadConfig } from "../src/config";
import { createDatabase, migrateToLatest, type Db } from "../src/db";

let app: App | undefined;
let db: Db;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start() {
  const config = loadConfig({ DATABASE_URL: "file::memory:" });
  db = createDatabase(config.database);
  await migrateToLatest(db);
  app = await buildApp({ config, db, adapters: createAdapters(config), version: "1.2.3", logger: false });
  return app;
}

const auditRows = () => db.selectFrom("audit_log").select(["action", "target", "details"]).orderBy("id").execute();

describe("overview API", () => {
  it("returns a schema-valid overview built from the demo adapters", async () => {
    const res = await (await start()).inject("/api/v1/overview");
    expect(res.statusCode).toBe(200);
    const overview = res.json<Overview>();
    expect(Value.Errors(Overview, overview)).toEqual([]);
    expect(overview.accounts.map((a) => [a.number, a.state])).toEqual([
      ["1111111", "running"],
      ["2222222", "running"],
      ["3333333", "stopped"],
    ]);
    expect(overview.accounts[0]).toMatchObject({ displayName: "Demo Prop A Challenge", currency: "USD" });
    expect(overview.instances.find((i) => i.name === "alpha-ger40-a")).toMatchObject({
      openPositions: 1,
      account: "1111111",
    });
    expect(overview.alerts).toContainEqual(
      expect.objectContaining({ code: "instance_error", subject: "beta-us500-own" }),
    );
  });

  it("returns the host status", async () => {
    const res = await (await start()).inject("/api/v1/host");
    expect(res.json()).toMatchObject({ ntpSynced: true, memTotal: 4 * 1024 ** 3 });
  });
});

describe("instance actions", () => {
  it("stops and starts an instance and writes the audit log", async () => {
    const server = await start();
    expect((await server.inject({ method: "POST", url: "/api/v1/instances/alpha-ger40-a/stop" })).statusCode).toBe(204);
    const status = async () =>
      (await server.inject("/api/v1/overview")).json<Overview>().instances.find((i) => i.ref === "alpha-ger40-a")
        ?.status;
    expect(await status()).toBe("stopped");
    await server.inject({ method: "POST", url: "/api/v1/instances/alpha-ger40-a/start" });
    expect(await status()).toBe("running");
    expect((await auditRows()).map((r) => r.action)).toEqual(["instance.stop", "instance.start"]);
  });

  it("answers 404 for unknown instances and 400 for unknown actions", async () => {
    const server = await start();
    const unknown = await server.inject({ method: "POST", url: "/api/v1/instances/nope/start" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "not_found" });
    expect((await auditRows())[0]).toMatchObject({ action: "instance.start", target: "nope" });
    expect((await server.inject({ method: "POST", url: "/api/v1/instances/alpha-ger40-a/delete" })).statusCode).toBe(
      400,
    );
  });
});

describe("emergency stop", () => {
  const stop = (server: App, number: string, confirm: string) =>
    server.inject({ method: "POST", url: `/api/v1/accounts/${number}/emergency-stop`, payload: { confirm } });

  it("requires the account number as confirmation", async () => {
    const server = await start();
    const res = await stop(server, "1111111", "yes");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "confirmation_required" });
    expect(await auditRows()).toEqual([]);
  });

  it("stops the account's instances, closes positions, cancels orders and audits it", async () => {
    const server = await start();
    const res = await stop(server, "1111111", "1111111");
    expect(res.statusCode).toBe(200);
    expect(res.json<EmergencyStopReport>()).toEqual({
      stoppedInstances: ["alpha-ger40-a", "beta-nas100-a"],
      failedInstances: [],
      closed: 1,
      cancelled: 1,
    });

    const overview = (await server.inject("/api/v1/overview")).json<Overview>();
    expect(overview.accounts.find((a) => a.number === "1111111")).toMatchObject({ state: "stopped", openPositions: 0 });
    // Other accounts are untouched.
    expect(overview.accounts.find((a) => a.number === "2222222")).toMatchObject({ state: "running", openPositions: 1 });

    const [row] = await auditRows();
    expect(row).toMatchObject({ action: "account.emergency_stop", target: "1111111" });
    expect(JSON.parse(row!.details!)).toMatchObject({ ok: true, closed: 1, cancelled: 1 });
  });

  it("answers 404 for unknown accounts", async () => {
    expect((await stop(await start(), "999", "999")).statusCode).toBe(404);
  });
});
