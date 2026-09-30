import { Value } from "typebox/value";
import { AccountDetail, Overview, type EmergencyStopReport } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
beforeEach(async () => {
  t = await startApp();
  admin = await loginAs(t, "admin");
});
afterEach(async () => {
  await t.app.close();
});

const get = (url: string, cookie = admin) => t.app.inject({ url, headers: { cookie } });
const post = (url: string, payload?: object, cookie = admin) =>
  t.app.inject({ method: "POST", url, headers: { cookie }, ...(payload ? { payload } : {}) });
const auditRows = () =>
  t.db
    .selectFrom("audit_log")
    .select(["action", "target", "details", "user_id"])
    .where("action", "not like", "auth.%")
    .orderBy("id")
    .execute();

describe("overview API", () => {
  it("returns a schema-valid overview for the seeded demo accounts", async () => {
    const res = await get("/api/v1/overview");
    expect(res.statusCode).toBe(200);
    const overview = res.json<Overview>();
    expect(Value.Errors(Overview, overview)).toEqual([]);
    expect(overview.accounts.map((a) => [a.number, a.state])).toEqual([
      ["1111111", "running"],
      ["2222222", "running"],
      ["3333333", "stopped"],
    ]);
    expect(overview.accounts[0]).toMatchObject({
      displayName: "Demo Prop A Challenge",
      currency: "USD",
      credentialLabel: "Demo login A",
    });
    expect(overview.instances.find((i) => i.name === "alpha-ger40-a")).toMatchObject({
      openPositions: 1,
      account: "1111111",
    });
    expect(overview.alerts).toContainEqual(
      expect.objectContaining({ code: "instance_error", subject: "beta-us500-own" }),
    );
  });

  it("returns one account with its instances and all positions and orders with their instance", async () => {
    const res = await get("/api/v1/accounts/1111111/detail");
    expect(res.statusCode).toBe(200);
    const detail = res.json<AccountDetail>();
    expect(Value.Errors(AccountDetail, detail)).toEqual([]);
    expect(detail.account).toMatchObject({ number: "1111111", openPositions: 1, pendingOrders: 1 });
    expect(detail.instances.map((i) => i.name)).toEqual(["alpha-ger40-a", "beta-nas100-a"]);
    expect(detail.positions.map((p) => p.instance)).toEqual(["alpha-ger40-a"]);
    expect(detail.pendingOrders.map((o) => o.instance)).toEqual(["beta-nas100-a"]);
    // The overview counts the pending orders too.
    const overview = (await get("/api/v1/overview")).json<Overview>();
    expect(overview.accounts.find((a) => a.number === "1111111")?.pendingOrders).toBe(1);
    expect((await get("/api/v1/accounts/999/detail")).statusCode).toBe(404);
  });

  it("returns the host status", async () => {
    expect((await get("/api/v1/host")).json()).toMatchObject({ ntpSynced: true, memTotal: 4 * 1024 ** 3 });
  });

  it("requires a login", async () => {
    const res = await t.app.inject("/api/v1/overview");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthenticated" });
  });
});

describe("instance actions", () => {
  it("stops and starts an instance and writes the audit log with the user", async () => {
    expect((await post("/api/v1/instances/alpha-ger40-a/stop")).statusCode).toBe(204);
    const status = async () =>
      (await get("/api/v1/overview")).json<Overview>().instances.find((i) => i.ref === "alpha-ger40-a")?.status;
    expect(await status()).toBe("stopped");
    await post("/api/v1/instances/alpha-ger40-a/start");
    expect(await status()).toBe("running");
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(["instance.stop", "instance.start"]);
    expect(rows.every((r) => r.user_id !== null)).toBe(true);
  });

  it("answers 404 for unknown instances and 400 for unknown actions", async () => {
    const unknown = await post("/api/v1/instances/nope/start");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "not_found" });
    expect((await auditRows())[0]).toMatchObject({ action: "instance.start", target: "nope" });
    expect((await post("/api/v1/instances/alpha-ger40-a/delete")).statusCode).toBe(400);
  });

  it("lets viewers read but not act", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await get("/api/v1/overview", viewer)).statusCode).toBe(200);
    const res = await post("/api/v1/instances/alpha-ger40-a/stop", undefined, viewer);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
    expect((await post("/api/v1/accounts/1111111/emergency-stop", { confirm: "1111111" }, viewer)).statusCode).toBe(
      403,
    );
  });
});

describe("emergency stop", () => {
  const stop = (number: string, confirm: string) => post(`/api/v1/accounts/${number}/emergency-stop`, { confirm });

  it("requires the account number as confirmation", async () => {
    const res = await stop("1111111", "yes");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "confirmation_required" });
    expect(await auditRows()).toEqual([]);
  });

  it("stops the account's instances, closes positions, cancels orders and audits it", async () => {
    const res = await stop("1111111", "1111111");
    expect(res.statusCode).toBe(200);
    expect(res.json<EmergencyStopReport>()).toEqual({
      stoppedInstances: ["alpha-ger40-a", "beta-nas100-a"],
      failedInstances: [],
      closed: 1,
      cancelled: 1,
    });

    const overview = (await get("/api/v1/overview")).json<Overview>();
    expect(overview.accounts.find((a) => a.number === "1111111")).toMatchObject({ state: "stopped", openPositions: 0 });
    expect(overview.accounts.find((a) => a.number === "2222222")).toMatchObject({ state: "running", openPositions: 1 });

    const [row] = await auditRows();
    expect(row).toMatchObject({ action: "account.emergency_stop", target: "1111111" });
    expect(JSON.parse(row!.details!)).toMatchObject({ ok: true, closed: 1, cancelled: 1 });
  });

  it("answers 404 for unknown accounts", async () => {
    expect((await stop("999", "999")).statusCode).toBe(404);
  });
});

describe("cancelling an order", () => {
  it("needs the order id as confirmation, cancels it at the broker and audits it", async () => {
    const orders = async () =>
      (await get("/api/v1/instances/beta-nas100-a")).json<{ pendingOrders: { id: string }[] }>().pendingOrders;
    const [order] = await orders();
    expect(order).toBeDefined();
    const url = `/api/v1/accounts/1111111/orders/${order!.id}/cancel`;

    expect((await post(url, { confirm: "yes" })).json()).toEqual({ error: "confirmation_required" });
    const res = await post(url, { confirm: order!.id });
    expect(res.statusCode).toBe(204);
    expect((await orders()).some((o) => o.id === order!.id)).toBe(false);
    const [row] = await auditRows();
    expect(row).toMatchObject({ action: "order.cancel", target: `1111111/${order!.id}` });

    expect((await post(url, { confirm: order!.id })).statusCode).toBe(404);
  });
});

describe("credentials and accounts", () => {
  it("stores secrets encrypted and never returns them", async () => {
    const created = await post("/api/v1/credentials", {
      label: "Main login",
      login: "me@example.com",
      secret: "s3cret!",
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain("s3cret!");

    const list = await get("/api/v1/credentials");
    expect(list.body).not.toContain("s3cret!");
    expect(list.json()).toContainEqual(expect.objectContaining({ label: "Main login", login: "me@example.com" }));

    const row = await t.db
      .selectFrom("credentials")
      .select("secret")
      .where("label", "=", "Main login")
      .executeTakeFirstOrThrow();
    expect(row.secret).toMatch(/^v1\./);
    expect(t.cipher.decrypt(row.secret, "credential-secret")).toBe("s3cret!");
  });

  it("adds an account only if the broker knows it, and removes it again", async () => {
    await t.db.deleteFrom("accounts").where("number", "=", "2222222").execute();
    const { id: credentialId } = await t.db.selectFrom("credentials").select("id").executeTakeFirstOrThrow();

    const unknown = await post("/api/v1/accounts", { number: "999", displayName: "Nope", credentialId });
    expect(unknown.json()).toEqual({ error: "account_not_found_at_broker" });

    const duplicate = await post("/api/v1/accounts", { number: "1111111", displayName: "Again", credentialId });
    expect(duplicate.statusCode).toBe(409);

    const created = await post("/api/v1/accounts", {
      number: "2222222",
      displayName: "Prop B",
      credentialId,
      timezone: "Europe/Berlin",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ broker: "Demo Broker", currency: "USD", timezone: "Europe/Berlin" });

    const inUse = await t.app.inject({
      method: "DELETE",
      url: `/api/v1/credentials/${credentialId}`,
      headers: { cookie: admin },
    });
    expect(inUse.json()).toEqual({ error: "credential_in_use" });

    const id = created.json<{ id: number }>().id;
    const removed = await t.app.inject({ method: "DELETE", url: `/api/v1/accounts/${id}`, headers: { cookie: admin } });
    expect(removed.statusCode).toBe(204);
    expect((await get("/api/v1/accounts")).json<{ number: string }[]>().map((a) => a.number)).toEqual([
      "1111111",
      "3333333",
    ]);
  });

  it("keeps credentials away from viewers", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await get("/api/v1/credentials", viewer)).statusCode).toBe(403);
    expect((await get("/api/v1/accounts", viewer)).statusCode).toBe(200);
  });
});

describe("managing logins and accounts", () => {
  const patch = (url: string, payload: object, cookie = admin) =>
    t.app.inject({ method: "PATCH", url, headers: { cookie }, payload });

  it("lists logins with usage and changes a password without exposing it", async () => {
    const list = (await get("/api/v1/credentials")).json<{ id: number; label: string; accounts: number }[]>();
    expect(list.map((c) => [c.label, c.accounts])).toEqual([
      ["Demo login A", 2],
      ["Demo login B", 1],
    ]);
    const id = list[0]!.id;
    const res = await patch(`/api/v1/credentials/${String(id)}`, { secret: "new-password!" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("new-password!");
    const row = await t.db.selectFrom("credentials").select("secret").where("id", "=", id).executeTakeFirstOrThrow();
    expect(t.cipher.decrypt(row.secret, "credential-secret")).toBe("new-password!");
    const audit = await t.db
      .selectFrom("audit_log")
      .select("details")
      .where("action", "=", "credential.update")
      .executeTakeFirstOrThrow();
    expect(audit.details).toBe(JSON.stringify({ changed: ["secret"] }));
  });

  it("offers the broker's accounts for a login and marks those already added", async () => {
    const [login] = (await get("/api/v1/credentials")).json<{ id: number }[]>();
    const offered = (await get(`/api/v1/credentials/${String(login!.id)}/broker-accounts`)).json<
      { number: string; added: boolean }[]
    >();
    expect(offered.map((a) => [a.number, a.added])).toEqual([
      ["1111111", true],
      ["2222222", true],
      ["3333333", true],
    ]);
  });

  it("renames an account and switches its login", async () => {
    const accounts = (await get("/api/v1/accounts")).json<
      { id: number; number: string; credentialLabel: string; hasChallenge: boolean }[]
    >();
    const own = accounts.find((a) => a.number === "3333333")!;
    expect(own).toMatchObject({ credentialLabel: "Demo login A", hasChallenge: false });
    const logins = (await get("/api/v1/credentials")).json<{ id: number; label: string }[]>();
    const loginB = logins.find((c) => c.label === "Demo login B")!;
    const res = await patch(`/api/v1/accounts/${String(own.id)}`, { displayName: "Personal", credentialId: loginB.id });
    expect(res.json()).toMatchObject({ displayName: "Personal", credentialLabel: "Demo login B" });
    expect((await patch("/api/v1/accounts/999", { displayName: "x" })).statusCode).toBe(404);
  });
});

describe("accounts of another broker adapter", () => {
  it("are not listed", async () => {
    const now = new Date().toISOString();
    await t.db
      .insertInto("accounts")
      .values({
        adapter: "other",
        number: "7777777",
        broker: "X",
        currency: "USD",
        display_name: "Other",
        credential_id: null,
        timezone: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const numbers = (await get("/api/v1/accounts")).json<{ number: string }[]>().map((a) => a.number);
    expect(numbers).toEqual(["1111111", "2222222", "3333333"]);
  });
});

describe("logins of another broker adapter", () => {
  it("hides logins that only accounts of another adapter use, like those accounts", async () => {
    // The demo data (logins and accounts of the demo broker) stays in the database after switching.
    const other = await startApp({ BROKER_ADAPTER: "ctrader-cli" });
    try {
      const cookie = await loginAs(other, "admin");
      await other.app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        headers: { cookie },
        payload: { label: "cTrader", login: "me@example.com", secret: "s3cret!" },
      });
      const list = await other.app.inject({ url: "/api/v1/credentials", headers: { cookie } });
      expect(list.json<{ label: string; accounts: number }[]>().map((c) => [c.label, c.accounts])).toEqual([
        ["cTrader", 0],
      ]);
      expect((await other.app.inject({ url: "/api/v1/accounts", headers: { cookie } })).json()).toEqual([]);
    } finally {
      await other.app.close();
      await other.db.destroy();
    }
  });
});
