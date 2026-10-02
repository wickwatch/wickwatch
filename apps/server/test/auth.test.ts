import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { auth } from "../src/plugins/auth";
import { totpCode, totpCounter } from "../src/security/totp";
import {
  createUser,
  currentCode,
  loginAs,
  PASSWORD,
  SETUP_TOKEN,
  sessionCookie,
  startApp,
  type TestApp,
} from "./helpers";

let t: TestApp;
afterEach(async () => {
  await t.app.close();
});

const session = (cookie?: string) =>
  t.app.inject({ url: "/api/v1/auth/session", ...(cookie ? { headers: { cookie } } : {}) });
const post = (url: string, payload: object = {}, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "POST", url, payload, headers });
const auditActions = async () =>
  (await t.db.selectFrom("audit_log").select(["action", "details"]).orderBy("id").execute()).map((a) => ({
    action: a.action,
    details: a.details ? (JSON.parse(a.details) as unknown) : null,
  }));

/** Waits until the next 30-second step, so a fresh code differs from the last one used. */
const nextStep = async () => {
  const ms = 30_000 - (Date.now() % 30_000) + 50;
  await new Promise((r) => setTimeout(r, ms));
};

describe("first-run setup", () => {
  it("creates the admin with 2FA, logs in and closes setup", async () => {
    t = await startApp();
    expect((await session()).json()).toEqual({ setupRequired: true, masterKeyConfigured: true });

    const totp = await post("/api/v1/auth/setup/totp", { token: SETUP_TOKEN, username: "admin" });
    expect(totp.statusCode).toBe(200);
    const { secret, uri, qr } = totp.json<{ secret: string; uri: string; qr: string }>();
    expect(uri).toContain(`secret=${secret}`);
    expect(qr).toMatch(/^data:image\/png;base64,/);

    const res = await post("/api/v1/auth/setup", {
      token: SETUP_TOKEN,
      username: "admin",
      password: PASSWORD,
      code: currentCode(secret),
    });
    expect(res.json()).toEqual({ username: "admin", role: "admin", totpEnabled: true, apiTokens: 0 });

    const cookie = sessionCookie(res);
    expect(res.cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
    expect((await session(cookie)).json()).toEqual({
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "admin", role: "admin", totpEnabled: true, apiTokens: 0 },
    });
    expect((await post("/api/v1/auth/setup/totp", { token: SETUP_TOKEN, username: "x" })).json()).toEqual({
      error: "setup_done",
    });

    const row = await t.db.selectFrom("users").select(["password_hash", "totp_secret"]).executeTakeFirstOrThrow();
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.totp_secret).not.toContain(secret);
  });

  it("can skip 2FA", async () => {
    t = await startApp();
    const res = await post("/api/v1/auth/setup", { token: SETUP_TOKEN, username: "admin", password: PASSWORD });
    expect(res.json()).toEqual({ username: "admin", role: "admin", totpEnabled: false, apiTokens: 0 });
    const row = await t.db.selectFrom("users").select("totp_secret").executeTakeFirstOrThrow();
    expect(row.totp_secret).toBeNull();
    expect((await auditActions())[0]).toEqual({ action: "auth.setup", details: { totp: false } });
  });

  it("refuses a wrong token, a weak password and a wrong code", async () => {
    t = await startApp();
    expect((await post("/api/v1/auth/setup/totp", { token: "nope", username: "admin" })).json()).toEqual({
      error: "invalid_setup_token",
    });
    expect((await post("/api/v1/auth/setup", { token: "nope", username: "admin", password: PASSWORD })).json()).toEqual(
      { error: "invalid_setup_token" },
    );
    const base = { token: SETUP_TOKEN, username: "admin" };
    expect((await post("/api/v1/auth/setup", { ...base, password: "short" })).json()).toEqual({
      error: "weak_password",
    });
    await post("/api/v1/auth/setup/totp", base);
    expect((await post("/api/v1/auth/setup", { ...base, password: PASSWORD, code: "000000" })).json()).toEqual({
      error: "invalid_code",
    });
    expect((await session()).json()).toMatchObject({ setupRequired: true });
  });

  it("needs MASTER_KEY", async () => {
    t = await startApp({ MASTER_KEY: "" }, { seed: false });
    expect((await session()).json()).toMatchObject({ masterKeyConfigured: false });
    expect((await post("/api/v1/auth/setup/totp", { token: SETUP_TOKEN, username: "admin" })).json()).toEqual({
      error: "master_key_missing",
    });
  });
});

describe("login", () => {
  it("logs in with password only when 2FA is off, and logs out", async () => {
    t = await startApp();
    await createUser(t, "anna", "viewer", { totp: false });
    const res = await post("/api/v1/auth/login", { username: "anna", password: PASSWORD });
    expect(res.json()).toEqual({ username: "anna", role: "viewer", totpEnabled: false, apiTokens: 0 });
    const cookie = sessionCookie(res);

    expect((await t.app.inject({ url: "/api/v1/overview", headers: { cookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } })).statusCode).toBe(
      204,
    );
    expect((await t.app.inject({ url: "/api/v1/overview", headers: { cookie } })).statusCode).toBe(401);
    expect((await auditActions()).map((a) => a.action)).toEqual(["auth.login", "auth.logout"]);
  });

  it("asks for the code only after the right password when 2FA is on", async () => {
    t = await startApp();
    const secret = await createUser(t, "anna", "admin");
    const missing = await post("/api/v1/auth/login", { username: "anna", password: PASSWORD });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "totp_required" });

    const wrongPassword = await post("/api/v1/auth/login", { username: "anna", password: "wrong password!" });
    expect(wrongPassword.json()).toEqual({ error: "invalid_credentials" });

    const ok = await post("/api/v1/auth/login", { username: "anna", password: PASSWORD, code: currentCode(secret) });
    expect(ok.json()).toEqual({ username: "anna", role: "admin", totpEnabled: true, apiTokens: 0 });
  });

  it("gives the same answer for unknown user, wrong password and wrong code", async () => {
    t = await startApp();
    const secret = await createUser(t, "anna", "admin");
    const attempts = [
      { username: "nobody", password: PASSWORD, code: currentCode(secret) },
      { username: "anna", password: "wrong password!", code: currentCode(secret) },
      { username: "anna", password: PASSWORD, code: "000000" },
    ];
    for (const payload of attempts) {
      const res = await post("/api/v1/auth/login", payload);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "invalid_credentials" });
    }
    expect((await auditActions()).map((a) => a.details)).toEqual([{ ok: false }, { ok: false }, { ok: false }]);
  });

  it("does not accept the same code twice", async () => {
    t = await startApp();
    const secret = await createUser(t, "anna", "admin");
    const code = totpCode(secret, totpCounter(Date.now()));
    expect((await post("/api/v1/auth/login", { username: "anna", password: PASSWORD, code })).statusCode).toBe(200);
    expect((await post("/api/v1/auth/login", { username: "anna", password: PASSWORD, code })).statusCode).toBe(401);
  });

  it("rate-limits login attempts", async () => {
    t = await startApp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await post("/api/v1/auth/login", { username: "x", password: "y" })).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    const last = await post("/api/v1/auth/login", { username: "x", password: "y" });
    expect(last.statusCode).toBe(429);
    expect(last.json()).toEqual({ error: "rate_limited" });
  });

  it("rejects state changes from another origin", async () => {
    t = await startApp();
    await createUser(t, "anna", "admin", { totp: false });
    const payload = { username: "anna", password: PASSWORD };
    const res = await post("/api/v1/auth/login", payload, { origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden_origin" });
    const same = await post("/api/v1/auth/login", payload, { origin: "http://localhost:80", host: "localhost:80" });
    expect(same.statusCode).toBe(200);
  });

  it("scopes the cookie to the base path", async () => {
    t = await startApp({ BASE_PATH: "/bots" });
    await createUser(t, "anna", "admin", { totp: false });
    const res = await post("/bots/api/v1/auth/login", { username: "anna", password: PASSWORD });
    expect(res.cookies[0]).toMatchObject({ path: "/bots/" });
  });
});

describe("changing the password", () => {
  it("needs the current password, logs out other sessions and keeps this one", async () => {
    t = await startApp();
    await createUser(t, "anna", "admin", { totp: false });
    const login = async (password: string) => post("/api/v1/auth/login", { username: "anna", password });
    const cookie = sessionCookie(await login(PASSWORD));
    const other = sessionCookie(await login(PASSWORD));
    const headers = { cookie };

    expect(
      (await post("/api/v1/auth/password", { current: "wrong password!", next: "a new passphrase" }, headers)).json(),
    ).toEqual({
      error: "invalid_password",
    });
    expect((await post("/api/v1/auth/password", { current: PASSWORD, next: "short" }, headers)).json()).toEqual({
      error: "weak_password",
    });
    expect(
      (await post("/api/v1/auth/password", { current: PASSWORD, next: "a new passphrase" }, headers)).statusCode,
    ).toBe(204);

    expect((await session(cookie)).json()).toMatchObject({ user: { username: "anna" } });
    expect((await session(other)).json()).not.toHaveProperty("user");
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login("a new passphrase")).statusCode).toBe(200);
    const actions = (await auditActions()).map((a) => a.action).filter((a) => a === "auth.password_change");
    expect(actions).toHaveLength(3);
    expect((await post("/api/v1/auth/password", { current: PASSWORD, next: "a new passphrase" })).statusCode).toBe(401);
  });
});

describe("turning 2FA on and off", () => {
  it("enables 2FA with a confirmed code and disables it with the password and a code", async () => {
    t = await startApp();
    await createUser(t, "anna", "admin", { totp: false });
    const cookie = sessionCookie(await post("/api/v1/auth/login", { username: "anna", password: PASSWORD }));
    const headers = { cookie };

    const setup = await post("/api/v1/auth/totp/setup", {}, headers);
    const { secret } = setup.json<{ secret: string }>();
    expect((await post("/api/v1/auth/totp/enable", { code: "000000" }, headers)).json()).toEqual({
      error: "invalid_code",
    });
    expect((await post("/api/v1/auth/totp/enable", { code: currentCode(secret) }, headers)).statusCode).toBe(204);
    expect((await session(cookie)).json()).toMatchObject({ user: { totpEnabled: true } });
    expect((await post("/api/v1/auth/totp/setup", {}, headers)).json()).toEqual({ error: "totp_already_enabled" });

    // Now the code is needed to log in (in the next 30-second step: the last code was just used).
    await nextStep();
    expect((await post("/api/v1/auth/login", { username: "anna", password: PASSWORD })).json()).toEqual({
      error: "totp_required",
    });
    const login = await post("/api/v1/auth/login", { username: "anna", password: PASSWORD, code: currentCode(secret) });
    expect(login.statusCode).toBe(200);

    const disable = (body: object) => post("/api/v1/auth/totp/disable", body, headers);
    const code = currentCode(secret);
    expect((await disable({ password: PASSWORD })).statusCode).toBe(400);
    const wrongPassword = await disable({ password: "wrong password!", code });
    expect([wrongPassword.statusCode, wrongPassword.json()]).toEqual([403, { error: "invalid_password" }]);
    const wrongCode = await disable({ password: PASSWORD, code: code === "000000" ? "111111" : "000000" });
    expect([wrongCode.statusCode, wrongCode.json()]).toEqual([401, { error: "invalid_credentials" }]);
    // The code that just logged in does not count again.
    const replayed = await disable({ password: PASSWORD, code });
    expect([replayed.statusCode, replayed.json()]).toEqual([401, { error: "invalid_credentials" }]);
    expect((await session(cookie)).json()).toMatchObject({ user: { totpEnabled: true } });

    const next = totpCode(secret, totpCounter(Date.now()) + 1);
    expect((await disable({ password: PASSWORD, code: next })).statusCode).toBe(204);
    expect((await session(cookie)).json()).toMatchObject({ user: { totpEnabled: false } });
    expect((await disable({ password: PASSWORD, code: next })).json()).toEqual({ error: "totp_not_enabled" });

    const disables = (await auditActions()).filter((a) => a.action.startsWith("auth.totp"));
    expect(disables).toEqual([
      { action: "auth.totp_enable", details: null },
      { action: "auth.totp_disable", details: { ok: false, error: "invalid_password" } },
      { action: "auth.totp_disable", details: { ok: false, error: "invalid_credentials" } },
      { action: "auth.totp_disable", details: { ok: false, error: "invalid_credentials" } },
      { action: "auth.totp_disable", details: { ok: true } },
    ]);
  }, 40_000);

  it("needs a session", async () => {
    t = await startApp();
    expect((await post("/api/v1/auth/totp/setup")).statusCode).toBe(401);
    expect((await post("/api/v1/auth/totp/disable", { password: PASSWORD, code: "123456" })).statusCode).toBe(401);
  });
});

describe("admin-only writes", () => {
  it("keeps a state-changing route without its own guard for admins", async () => {
    t = await startApp();
    const probe = Fastify({ logger: false });
    await probe.register(auth, { db: t.db, basePath: "", mcp: true });
    probe.post("/api/v1/probe", () => ({ ok: true }));
    probe.post("/api/v1/auth/probe", () => ({ ok: true }));
    probe.get("/api/v1/probe", () => ({ ok: true }));
    const inject = (method: "GET" | "POST", url: string, cookie: string) =>
      probe.inject({ method, url, headers: { cookie } });
    try {
      const viewer = await loginAs(t, "viewer");
      const admin = await loginAs(t, "admin");
      expect((await inject("POST", "/api/v1/probe", viewer)).json()).toEqual({ error: "forbidden" });
      expect((await inject("POST", "/api/v1/probe", admin)).statusCode).toBe(200);
      expect((await inject("GET", "/api/v1/probe", viewer)).statusCode).toBe(200);
      expect((await inject("POST", "/api/v1/auth/probe", viewer)).statusCode).toBe(200);
    } finally {
      await probe.close();
    }
  });
});
