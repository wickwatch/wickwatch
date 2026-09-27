import { afterEach, describe, expect, it } from "vitest";
import { totpCode, totpCounter } from "../src/security/totp";
import { createUser, currentCode, PASSWORD, SETUP_TOKEN, sessionCookie, startApp, type TestApp } from "./helpers";

let t: TestApp;
afterEach(async () => {
  await t.app.close();
});

const session = (cookie?: string) =>
  t.app.inject({ url: "/api/v1/auth/session", ...(cookie ? { headers: { cookie } } : {}) });
const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  t.app.inject({ method: "POST", url, payload, headers });

describe("first-run setup", () => {
  it("creates the admin with password and TOTP, logs in and closes setup", async () => {
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
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ username: "admin", role: "admin" });

    const cookie = sessionCookie(res);
    expect(res.cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
    expect((await session(cookie)).json()).toEqual({
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "admin", role: "admin" },
    });

    const again = await post("/api/v1/auth/setup/totp", { token: SETUP_TOKEN, username: "other" });
    expect(again.json()).toEqual({ error: "setup_done" });

    const row = await t.db.selectFrom("users").select(["password_hash", "totp_secret"]).executeTakeFirstOrThrow();
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.totp_secret).not.toContain(secret);
  });

  it("refuses a wrong token, a weak password and a wrong code", async () => {
    t = await startApp();
    expect((await post("/api/v1/auth/setup/totp", { token: "nope", username: "admin" })).json()).toEqual({
      error: "invalid_setup_token",
    });
    const { secret } = (await post("/api/v1/auth/setup/totp", { token: SETUP_TOKEN, username: "admin" })).json<{
      secret: string;
    }>();
    const base = { token: SETUP_TOKEN, username: "admin" };
    expect(
      (await post("/api/v1/auth/setup", { ...base, password: "short", code: currentCode(secret) })).json(),
    ).toEqual({
      error: "weak_password",
    });
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
  it("logs in with password and code, and logs out", async () => {
    t = await startApp();
    const secret = await createUser(t, "anna", "viewer");
    const res = await post("/api/v1/auth/login", { username: "anna", password: PASSWORD, code: currentCode(secret) });
    expect(res.json()).toEqual({ username: "anna", role: "viewer" });
    const cookie = sessionCookie(res);

    expect((await t.app.inject({ url: "/api/v1/overview", headers: { cookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } })).statusCode).toBe(
      204,
    );
    expect((await t.app.inject({ url: "/api/v1/overview", headers: { cookie } })).statusCode).toBe(401);

    const actions = await t.db.selectFrom("audit_log").select("action").orderBy("id").execute();
    expect(actions.map((a) => a.action)).toEqual(["auth.login", "auth.logout"]);
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
    const failures = await t.db.selectFrom("audit_log").select("details").where("action", "=", "auth.login").execute();
    expect(failures.map((f) => JSON.parse(f.details!) as unknown)).toEqual([
      { ok: false },
      { ok: false },
      { ok: false },
    ]);
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
      codes.push((await post("/api/v1/auth/login", { username: "x", password: "y", code: "000000" })).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    const last = await post("/api/v1/auth/login", { username: "x", password: "y", code: "000000" });
    expect(last.statusCode).toBe(429);
    expect(last.json()).toEqual({ error: "rate_limited" });
  });

  it("rejects state changes from another origin", async () => {
    t = await startApp();
    const secret = await createUser(t, "anna", "admin");
    const res = await post(
      "/api/v1/auth/login",
      { username: "anna", password: PASSWORD, code: currentCode(secret) },
      { origin: "https://evil.example" },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden_origin" });
    const same = await post(
      "/api/v1/auth/login",
      { username: "anna", password: PASSWORD, code: currentCode(secret) },
      { origin: "http://localhost:80", host: "localhost:80" },
    );
    expect(same.statusCode).toBe(200);
  });

  it("scopes the cookie to the base path", async () => {
    t = await startApp({ BASE_PATH: "/bots" });
    const secret = await createUser(t, "anna", "admin");
    const res = await post("/bots/api/v1/auth/login", {
      username: "anna",
      password: PASSWORD,
      code: currentCode(secret),
    });
    expect(res.cookies[0]).toMatchObject({ path: "/bots/" });
  });
});
