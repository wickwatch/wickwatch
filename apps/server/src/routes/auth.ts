import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { MIN_PASSWORD_LENGTH } from "@wickwatch/core/rules";
import type { FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import Type from "typebox";
import { type SetupState, needsSetup } from "../auth/setup";
import { countApiTokens, deleteUserApiTokens } from "../auth/api-tokens";
import { createSession, deleteOtherSessions, deleteSession, SESSION_COOKIE } from "../auth/sessions";
import type { Db } from "../db";
import { ErrorBody } from "../plugins/errors";
import { clearSessionCookie, setSessionCookie } from "../plugins/auth";
import type { Cipher } from "../security/cipher";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../security/password";
import { generateTotpSecret, totpUri, verifyTotp } from "../security/totp";
import { audit } from "../services/audit";

const User = Type.Object({
  username: Type.String(),
  role: Type.Union([Type.Literal("admin"), Type.Literal("viewer")]),
  totpEnabled: Type.Boolean(),
  /** API tokens the user created; they outlive a password change unless deleted with it. */
  apiTokens: Type.Integer({ minimum: 0 }),
});

const Session = Type.Object({
  setupRequired: Type.Boolean(),
  /** False when MASTER_KEY is missing: setup and stored credentials are then impossible. */
  masterKeyConfigured: Type.Boolean(),
  user: Type.Optional(User),
});

const TotpSetup = Type.Object({
  secret: Type.String(),
  uri: Type.String(),
  /** PNG data URL of the QR code. */
  qr: Type.String(),
});

const Username = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._@-]+$" });
const Password = Type.String({ maxLength: 256 });
const Code = Type.String({ minLength: 6, maxLength: 8 });

// Endpoints that check passwords or codes: slow down guessing.
const limited = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export interface AuthRouteOptions {
  db: Db;
  cipher: Cipher | undefined;
  setup: SetupState;
  basePath: string;
}

async function totpSetup(secret: string, username: string) {
  const uri = totpUri(secret, username);
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
}

export const authRoutes: FastifyPluginAsyncTypebox<AuthRouteOptions> = async (app, { db, cipher, setup, basePath }) => {
  /** Secrets shown to logged-in users who are enabling 2FA, until they confirm a code. */
  const pendingTotp = new Map<number, string>();

  const loadUser = (id: number) => db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  function requireUser(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) void reply.code(401).send({ error: "unauthenticated" });
    return request.user;
  }

  app.get(
    "/session",
    {
      schema: { tags: ["auth"], summary: "Who is logged in, and whether setup is needed", response: { 200: Session } },
    },
    async (request) => {
      const user = request.user ? await loadUser(request.user.id) : undefined;
      return {
        setupRequired: await needsSetup(db),
        masterKeyConfigured: cipher !== undefined,
        ...(user
          ? {
              user: {
                username: user.username,
                role: user.role,
                totpEnabled: user.totp_secret !== null,
                apiTokens: await countApiTokens(db, user.id),
              },
            }
          : {}),
      };
    },
  );

  app.post(
    "/setup/totp",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "First run: check the setup token and get a TOTP secret for the admin (2FA is optional)",
        body: Type.Object({ token: Type.String(), username: Username }),
        response: { 200: TotpSetup, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!(await needsSetup(db))) return reply.code(409).send({ error: "setup_done" });
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      if (!setup.matches(request.body.token)) return reply.code(403).send({ error: "invalid_setup_token" });
      return totpSetup((setup.pendingTotpSecret ??= generateTotpSecret()), request.body.username);
    },
  );

  app.post(
    "/setup",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "First run: create the admin account and log in",
        description:
          "Without `code` the admin is created without 2FA; with it, the code must match the secret from /setup/totp.",
        body: Type.Object({ token: Type.String(), username: Username, password: Password, code: Type.Optional(Code) }),
        response: { 200: User, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { token, username, password, code } = request.body;
      if (!(await needsSetup(db))) return reply.code(409).send({ error: "setup_done" });
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      if (!setup.matches(token)) return reply.code(403).send({ error: "invalid_setup_token" });
      if (password.length < MIN_PASSWORD_LENGTH) return reply.code(400).send({ error: "weak_password" });

      let totp: { secret: string; counter: number } | undefined;
      if (code !== undefined) {
        const secret = setup.pendingTotpSecret;
        const counter = secret ? verifyTotp(secret, code, Date.now()) : undefined;
        if (!secret || counter === undefined) return reply.code(400).send({ error: "invalid_code" });
        totp = { secret, counter };
      }

      const now = new Date().toISOString();
      const { id } = await db
        .insertInto("users")
        .values({
          username,
          password_hash: await hashPassword(password),
          totp_secret: totp ? cipher.encrypt(totp.secret, "totp-secret") : null,
          totp_last_counter: totp?.counter ?? null,
          role: "admin",
          created_at: now,
          updated_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      setup.complete();

      await audit(db, { action: "auth.setup", target: username, userId: id, details: { totp: totp !== undefined } });
      setSessionCookie(reply, await createSession(db, id), basePath);
      return { username, role: "admin" as const, totpEnabled: totp !== undefined, apiTokens: 0 };
    },
  );

  app.post(
    "/login",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "Log in with password, plus TOTP code if 2FA is enabled",
        description:
          "Wrong user name, password or code: 401 `invalid_credentials`. Right password but 2FA enabled and no `code`: 401 `totp_required`.",
        body: Type.Object({ username: Type.String({ maxLength: 64 }), password: Password, code: Type.Optional(Code) }),
        response: { 200: User, 401: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { username, password, code } = request.body;
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });

      const user = await db.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst();
      const passwordOk = user
        ? await verifyPassword(password, user.password_hash)
        : await verifyDummyPassword(password);
      const fail = async (error: string, details: Record<string, unknown> = {}) => {
        await audit(db, { action: "auth.login", target: username, details: { ok: false, ...details } });
        return reply.code(401).send({ error });
      };
      // One answer for unknown user and wrong password: do not reveal which one was wrong.
      if (!user || !passwordOk) return fail("invalid_credentials");

      if (user.totp_secret) {
        if (code === undefined) return fail("totp_required", { totpRequired: true });
        const secret = cipher.decrypt(user.totp_secret, "totp-secret");
        const counter = verifyTotp(secret, code, Date.now(), user.totp_last_counter ?? -1);
        if (counter === undefined) return fail("invalid_credentials");
        await db.updateTable("users").set({ totp_last_counter: counter }).where("id", "=", user.id).execute();
      }

      await audit(db, { action: "auth.login", target: username, userId: user.id, details: { ok: true } });
      setSessionCookie(reply, await createSession(db, user.id), basePath);
      return {
        username: user.username,
        role: user.role,
        totpEnabled: user.totp_secret !== null,
        apiTokens: await countApiTokens(db, user.id),
      };
    },
  );

  app.post(
    "/logout",
    { schema: { tags: ["auth"], summary: "End the session", response: { 204: Type.Null() } } },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await deleteSession(db, token);
      if (request.user)
        await audit(db, { action: "auth.logout", target: request.user.username, userId: request.user.id });
      clearSessionCookie(reply, basePath);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/totp/setup",
    {
      schema: {
        tags: ["auth"],
        summary: "Start enabling 2FA for the logged-in user: get a new TOTP secret",
        security: [{ session: [] }],
        response: { 200: TotpSetup, 401: ErrorBody, 409: ErrorBody },
      },
    },
    async (request, reply) => {
      const current = requireUser(request, reply);
      if (!current) return reply;
      if ((await loadUser(current.id)).totp_secret) return reply.code(409).send({ error: "totp_already_enabled" });
      const secret = generateTotpSecret();
      pendingTotp.set(current.id, secret);
      return totpSetup(secret, current.username);
    },
  );

  app.post(
    "/totp/enable",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "Finish enabling 2FA with a code for the secret from /totp/setup",
        security: [{ session: [] }],
        body: Type.Object({ code: Code }),
        response: { 204: Type.Null(), 400: ErrorBody, 401: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const current = requireUser(request, reply);
      if (!current) return reply;
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const secret = pendingTotp.get(current.id);
      const counter = secret ? verifyTotp(secret, request.body.code, Date.now()) : undefined;
      if (!secret || counter === undefined) return reply.code(400).send({ error: "invalid_code" });

      await db
        .updateTable("users")
        .set({
          totp_secret: cipher.encrypt(secret, "totp-secret"),
          totp_last_counter: counter,
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", current.id)
        .execute();
      pendingTotp.delete(current.id);
      await audit(db, { action: "auth.totp_enable", target: current.username, userId: current.id });
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/password",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "Change the password of the logged-in user; needs the current one",
        description:
          "Other sessions of the user are logged out; this one stays. API tokens stay valid unless `deleteApiTokens` " +
          "is true: then the user's tokens are deleted too, e.g. when the password may have leaked.",
        security: [{ session: [] }],
        body: Type.Object({
          current: Password,
          next: Password,
          deleteApiTokens: Type.Optional(Type.Boolean()),
        }),
        response: { 204: Type.Null(), 400: ErrorBody, 401: ErrorBody, 403: ErrorBody, 429: ErrorBody },
      },
    },
    async (request, reply) => {
      const current = requireUser(request, reply);
      if (!current) return reply;
      const user = await loadUser(current.id);
      const fail = async (code: 400 | 403, error: "invalid_password" | "weak_password") => {
        await audit(db, {
          action: "auth.password_change",
          target: current.username,
          userId: current.id,
          details: { ok: false, error },
        });
        return reply.code(code).send({ error });
      };
      if (!(await verifyPassword(request.body.current, user.password_hash))) return fail(403, "invalid_password");
      if (request.body.next.length < MIN_PASSWORD_LENGTH) return fail(400, "weak_password");
      await db
        .updateTable("users")
        .set({ password_hash: await hashPassword(request.body.next), updated_at: new Date().toISOString() })
        .where("id", "=", current.id)
        .execute();
      await deleteOtherSessions(db, current.id, request.cookies[SESSION_COOKIE]);
      const deleted = request.body.deleteApiTokens ? await deleteUserApiTokens(db, current.id) : [];
      await audit(db, {
        action: "auth.password_change",
        target: current.username,
        userId: current.id,
        details: { ok: true, ...(request.body.deleteApiTokens ? { apiTokensDeleted: deleted.length } : {}) },
      });
      for (const token of deleted) {
        await audit(db, {
          action: "api_token.delete",
          target: token.name,
          userId: current.id,
          details: { id: token.id, reason: "password_change" },
        });
      }
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/totp/disable",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "Turn 2FA off for the logged-in user; needs the password and a current code",
        description:
          "Wrong password: 403 `invalid_password`. Wrong or already used code: 401 `invalid_credentials`, as at login.",
        security: [{ session: [] }],
        body: Type.Object({ password: Password, code: Code }),
        response: { 204: Type.Null(), 401: ErrorBody, 403: ErrorBody, 409: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const current = requireUser(request, reply);
      if (!current) return reply;
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const user = await loadUser(current.id);
      if (!user.totp_secret) return reply.code(409).send({ error: "totp_not_enabled" });
      const fail = async (code: 401 | 403, error: "invalid_credentials" | "invalid_password") => {
        await audit(db, {
          action: "auth.totp_disable",
          target: current.username,
          userId: current.id,
          details: { ok: false, error },
        });
        return reply.code(code).send({ error });
      };
      if (!(await verifyPassword(request.body.password, user.password_hash))) return fail(403, "invalid_password");
      // Like the login, including the replay protection: the code that just logged in does not count again.
      const secret = cipher.decrypt(user.totp_secret, "totp-secret");
      if (verifyTotp(secret, request.body.code, Date.now(), user.totp_last_counter ?? -1) === undefined) {
        return fail(401, "invalid_credentials");
      }
      await db
        .updateTable("users")
        .set({ totp_secret: null, totp_last_counter: null, updated_at: new Date().toISOString() })
        .where("id", "=", current.id)
        .execute();
      await audit(db, {
        action: "auth.totp_disable",
        target: current.username,
        userId: current.id,
        details: { ok: true },
      });
      return reply.code(204).send(null);
    },
  );
};
