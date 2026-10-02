import { readdirSync, readFileSync } from "node:fs";
import { ApiToken, CreatedApiToken } from "@wickwatch/core";
import Value from "typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, currentCode, loginAs, PASSWORD, sessionCookie, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
beforeEach(async () => {
  t = await startApp();
  admin = await loginAs(t, "admin", "", { totp: false });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await t.app.close();
});

const create = (payload: object, cookie = admin) =>
  t.app.inject({
    method: "POST",
    url: "/api/v1/api-tokens",
    headers: { cookie },
    payload: { password: PASSWORD, ...payload },
  });
const createToken = async (payload: object = { name: "script", role: "viewer" }) => {
  const res = await create(payload);
  expect(res.statusCode).toBe(201);
  return res.json<CreatedApiToken>();
};
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("API tokens", () => {
  it("creates a token that is shown once and stored only as a hash", async () => {
    const created = await createToken({ name: "  grafana  ", role: "viewer", expiresInDays: 30 });
    expect(Value.Errors(CreatedApiToken, created)).toEqual([]);
    expect(created).toMatchObject({ name: "grafana", role: "viewer", user: "admin-user", expired: false });
    expect(created.token).toMatch(/^ww_[A-Za-z0-9_-]{43}$/);
    expect(created.token.startsWith(created.prefix)).toBe(true);
    expect(Date.parse(created.expiresAt ?? "") - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);

    const list = await t.app.inject({ url: "/api/v1/api-tokens", headers: { cookie: admin } });
    expect(list.statusCode).toBe(200);
    const tokens = list.json<ApiToken[]>();
    expect(Value.Errors(ApiToken, tokens[0])).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).not.toHaveProperty("token");

    const row = await t.db.selectFrom("api_tokens").selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(created.token);
    const audit = await t.db
      .selectFrom("audit_log")
      .select(["action", "target"])
      .where("action", "like", "api_token.%")
      .execute();
    expect(audit).toEqual([{ action: "api_token.create", target: "grafana" }]);
  });

  it("authenticates API requests with the token and records its last use", async () => {
    const { token } = await createToken();
    const res = await t.app.inject({ url: "/api/v1/overview", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const row = await t.db.selectFrom("api_tokens").select("last_used_at").executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
  });

  it("gives a viewer token read access only, even though its user is an admin", async () => {
    const { token } = await createToken({ name: "read", role: "viewer" });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/instances/alpha-ger40-a/stop",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
  });

  it("lets an admin token act, audited as its user with the token", async () => {
    const { id, token } = await createToken({ name: "ops", role: "admin" });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/instances/alpha-ger40-a/stop",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(204);
    // The same action from the web app carries no token.
    await t.app.inject({ method: "POST", url: "/api/v1/instances/alpha-ger40-a/start", headers: { cookie: admin } });

    const page = await t.app.inject({ url: "/api/v1/audit?action=instance.", headers: { cookie: admin } });
    const entries = page.json<{ entries: { action: string; user?: string; token?: unknown }[] }>().entries;
    expect(entries.map((e) => [e.action, e.user, e.token])).toEqual([
      ["instance.start", "admin-user", undefined],
      ["instance.stop", "admin-user", { id, name: "ops" }],
    ]);

    // The entry keeps the token's name after the token is gone.
    await t.app.inject({ method: "DELETE", url: `/api/v1/api-tokens/${String(id)}`, headers: { cookie: admin } });
    const after = await t.app.inject({ url: "/api/v1/audit?action=instance.stop", headers: { cookie: admin } });
    expect(after.json<{ entries: { token?: unknown }[] }>().entries[0]?.token).toEqual({ id, name: "ops" });
  });

  it("limits an admin token to viewer when its user is no admin any more", async () => {
    const { token } = await createToken({ name: "ops", role: "admin" });
    await t.db.updateTable("users").set({ role: "viewer" }).where("username", "=", "admin-user").execute();
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/instances/alpha-ger40-a/stop",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects unknown, deleted and expired tokens, also next to a valid session cookie", async () => {
    const unknown = await t.app.inject({ url: "/api/v1/overview", headers: { ...bearer("ww_nope"), cookie: admin } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.headers["www-authenticate"]).toBe('Bearer realm="wickwatch"');

    const { id, token } = await createToken();
    const del = await t.app.inject({
      method: "DELETE",
      url: `/api/v1/api-tokens/${String(id)}`,
      headers: { cookie: admin },
    });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ url: "/api/v1/overview", headers: bearer(token) })).statusCode).toBe(401);

    const expiring = await createToken({ name: "short", role: "viewer", expiresInDays: 1 });
    await t.db
      .updateTable("api_tokens")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .where("id", "=", expiring.id)
      .execute();
    expect((await t.app.inject({ url: "/api/v1/overview", headers: bearer(expiring.token) })).statusCode).toBe(401);
    const list = await t.app.inject({ url: "/api/v1/api-tokens", headers: { cookie: admin } });
    expect(list.json<ApiToken[]>()[0]).toMatchObject({ name: "short", expired: true });
  });

  it("keeps the session working behind a proxy that sends Basic auth", async () => {
    const res = await t.app.inject({
      url: "/api/v1/overview",
      headers: { authorization: "Basic dXNlcjpwYXNz", cookie: admin },
    });
    expect(res.statusCode).toBe(200);
  });

  // Regression: a leaked token must not mint more tokens, nor reach password and 2FA endpoints.
  it("does not let a token manage tokens or reach the auth endpoints", async () => {
    const { id, token } = await createToken({ name: "ops", role: "admin" });
    const list = await t.app.inject({ url: "/api/v1/api-tokens", headers: bearer(token) });
    expect(list.statusCode).toBe(403);
    expect(list.json()).toEqual({ error: "session_required" });
    const mint = await t.app.inject({
      method: "POST",
      url: "/api/v1/api-tokens",
      headers: bearer(token),
      payload: { name: "more", role: "admin", password: PASSWORD },
    });
    expect(mint.statusCode).toBe(403);
    const del = await t.app.inject({
      method: "DELETE",
      url: `/api/v1/api-tokens/${String(id)}`,
      headers: bearer(token),
    });
    expect(del.statusCode).toBe(403);

    const session = await t.app.inject({ url: "/api/v1/auth/session", headers: bearer(token) });
    expect(session.json()).not.toHaveProperty("user");
    const totp = await t.app.inject({ method: "POST", url: "/api/v1/auth/totp/setup", headers: bearer(token) });
    expect(totp.statusCode).toBe(401);
    expect(await t.db.selectFrom("api_tokens").select("id").execute()).toHaveLength(1);
  });

  it("is for admins only and validates the input", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await create({ name: "x", role: "viewer" }, viewer)).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/api/v1/api-tokens", headers: { cookie: viewer } })).statusCode).toBe(403);
    expect((await create({ name: "   ", role: "viewer" })).statusCode).toBe(400);
    expect((await create({ name: "x", role: "owner" })).statusCode).toBe(400);
    expect((await create({ name: "x", role: "viewer", expiresInDays: 0 })).statusCode).toBe(400);
    expect((await create({ name: "x", role: "viewer", expiresInDays: 366 })).statusCode).toBe(400);
    const missing = await t.app.inject({ method: "DELETE", url: "/api/v1/api-tokens/999", headers: { cookie: admin } });
    expect(missing.statusCode).toBe(404);
  });

  // Regression: an audit entry written with `userId` alone would hide which token acted.
  it("has every route audit its actor through actor(request)", () => {
    const dir = new URL("../src/routes/", import.meta.url);
    // auth.ts is out of reach for tokens: its entries name the user who logs in, sets up or changes 2FA.
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".ts") && file !== "auth.ts")
      .filter((file) => /\buserId:/.test(readFileSync(new URL(file, dir), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps tokens on a password change unless asked to delete them, and counts them in the session", async () => {
    await createToken({ name: "one", role: "viewer" });
    await createToken({ name: "two", role: "admin" });
    const session = await t.app.inject({ url: "/api/v1/auth/session", headers: { cookie: admin } });
    expect(session.json()).toMatchObject({ user: { username: "admin-user", apiTokens: 2 } });

    const change = (next: string, extra: object = {}) =>
      t.app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { cookie: admin },
        payload: { current: PASSWORD, next, ...extra },
      });
    expect((await change(PASSWORD)).statusCode).toBe(204);
    expect(await t.db.selectFrom("api_tokens").select("id").execute()).toHaveLength(2);

    expect((await change(PASSWORD, { deleteApiTokens: true })).statusCode).toBe(204);
    expect(await t.db.selectFrom("api_tokens").select("id").execute()).toEqual([]);
    const entries = await t.db
      .selectFrom("audit_log")
      .select(["action", "target", "details"])
      .where("action", "in", ["auth.password_change", "api_token.delete"])
      .orderBy("id")
      .execute();
    expect(entries.map((e) => [e.action, e.target, JSON.parse(e.details ?? "{}") as unknown])).toEqual([
      ["auth.password_change", "admin-user", { ok: true }],
      ["auth.password_change", "admin-user", { ok: true, apiTokensDeleted: 2 }],
      ["api_token.delete", "one", expect.objectContaining({ reason: "password_change" })],
      ["api_token.delete", "two", expect.objectContaining({ reason: "password_change" })],
    ]);
  });

  it("tells ALERT_WEBHOOK_URL about a new token, without the token itself", async () => {
    await t.app.close();
    t = await startApp({ ALERT_WEBHOOK_URL: "https://hooks.example/placeholder" });
    admin = await loginAs(t, "admin", "", { totp: false });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    const created = await createToken({ name: "ops", role: "admin" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, { body: string }];
    expect(url.href).toBe("https://hooks.example/placeholder");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      event: "api_token_created",
      user: "admin-user",
      token: { id: created.id, name: "ops", role: "admin" },
      text: "Security: admin-user created the API token ops with the role Admin; it does not expire.",
    });
    expect(init.body).not.toContain(created.token);
  });

  // Regression: a session left open must not be enough to mint lasting access.
  it("asks for the password again, and the 2FA code when it is on", async () => {
    const wrong = await create({ name: "x", role: "admin", password: "not the password" });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: "invalid_password" });
    const noPassword = await t.app.inject({
      method: "POST",
      url: "/api/v1/api-tokens",
      headers: { cookie: admin },
      payload: { name: "x", role: "admin" },
    });
    expect(noPassword.statusCode).toBe(400);
    expect(await t.db.selectFrom("api_tokens").select("id").execute()).toEqual([]);
    const failed = await t.db
      .selectFrom("audit_log")
      .select("details")
      .where("action", "=", "api_token.create")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(failed.details ?? "{}")).toEqual({ ok: false, error: "invalid_password" });

    const secret = await createUser(t, "anna", "admin");
    const login = await t.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "anna", password: PASSWORD, code: currentCode(secret) },
    });
    const anna = sessionCookie(login);
    const noCode = await create({ name: "x", role: "viewer" }, anna);
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json()).toEqual({ error: "totp_required" });
    // The code that just logged in was used: it does not count again.
    const replay = await create({ name: "x", role: "viewer", code: currentCode(secret) }, anna);
    expect(replay.json()).toEqual({ error: "invalid_credentials" });
    expect(await t.db.selectFrom("api_tokens").select("id").execute()).toEqual([]);
  });

  it("creates a token with a fresh 2FA code", async () => {
    const secret = await createUser(t, "anna", "admin");
    const login = await t.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "anna", password: PASSWORD, code: currentCode(secret) },
    });
    // Pretend the login used the previous step, so the current code is still fresh.
    await t.db.updateTable("users").set({ totp_last_counter: 0 }).where("username", "=", "anna").execute();
    const res = await create({ name: "x", role: "viewer", code: currentCode(secret) }, sessionCookie(login));
    expect(res.statusCode).toBe(201);
  });

  it("lets only users with 2FA create tokens with API_TOKENS_REQUIRE_2FA=on", async () => {
    await t.app.close();
    t = await startApp({ API_TOKENS_REQUIRE_2FA: "on" });
    admin = await loginAs(t, "admin", "", { totp: false });
    const res = await create({ name: "x", role: "viewer" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "totp_needed" });
    const system = await t.app.inject({ url: "/api/v1/system", headers: { cookie: admin } });
    expect(system.json()).toMatchObject({ apiTokensRequire2fa: true });
  });
});
