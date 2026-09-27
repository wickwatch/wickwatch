import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import QRCode from "qrcode";
import Type from "typebox";
import { type SetupState, needsSetup } from "../auth/setup";
import { createSession, deleteSession, SESSION_COOKIE } from "../auth/sessions";
import type { Db } from "../db";
import { ErrorBody } from "../plugins/errors";
import { clearSessionCookie, setSessionCookie } from "../plugins/auth";
import type { Cipher } from "../security/cipher";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyDummyPassword, verifyPassword } from "../security/password";
import { generateTotpSecret, totpUri, verifyTotp } from "../security/totp";
import { audit } from "../services/audit";

const User = Type.Object({
  username: Type.String(),
  role: Type.Union([Type.Literal("admin"), Type.Literal("viewer")]),
});

const Session = Type.Object({
  setupRequired: Type.Boolean(),
  /** False when MASTER_KEY is missing: setup and stored credentials are then impossible. */
  masterKeyConfigured: Type.Boolean(),
  user: Type.Optional(User),
});

const Username = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._@-]+$" });
const Code = Type.String({ minLength: 6, maxLength: 8 });

// Login and setup are the only unauthenticated write endpoints; slow down guessing.
const limited = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export interface AuthRouteOptions {
  db: Db;
  cipher: Cipher | undefined;
  setup: SetupState;
  basePath: string;
}

export const authRoutes: FastifyPluginAsyncTypebox<AuthRouteOptions> = async (app, { db, cipher, setup, basePath }) => {
  app.get(
    "/session",
    {
      schema: { tags: ["auth"], summary: "Who is logged in, and whether setup is needed", response: { 200: Session } },
    },
    async (request) => ({
      setupRequired: await needsSetup(db),
      masterKeyConfigured: cipher !== undefined,
      ...(request.user ? { user: { username: request.user.username, role: request.user.role } } : {}),
    }),
  );

  app.post(
    "/setup/totp",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "First run: get a TOTP secret for the admin account",
        body: Type.Object({ token: Type.String(), username: Username }),
        response: {
          200: Type.Object({ secret: Type.String(), uri: Type.String(), qr: Type.String() }),
          429: ErrorBody,
          400: ErrorBody,
          403: ErrorBody,
          409: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      if (!(await needsSetup(db))) return reply.code(409).send({ error: "setup_done" });
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      if (!setup.matches(request.body.token)) return reply.code(403).send({ error: "invalid_setup_token" });

      const secret = (setup.pendingTotpSecret ??= generateTotpSecret());
      const uri = totpUri(secret, request.body.username);
      return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
    },
  );

  app.post(
    "/setup",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "First run: create the admin account and log in",
        body: Type.Object({
          token: Type.String(),
          username: Username,
          password: Type.String({ maxLength: 256 }),
          code: Code,
        }),
        response: { 200: User, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { token, username, password, code } = request.body;
      if (!(await needsSetup(db))) return reply.code(409).send({ error: "setup_done" });
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      if (!setup.matches(token)) return reply.code(403).send({ error: "invalid_setup_token" });
      if (password.length < MIN_PASSWORD_LENGTH) return reply.code(400).send({ error: "weak_password" });

      const secret = setup.pendingTotpSecret;
      const counter = secret ? verifyTotp(secret, code, Date.now()) : undefined;
      if (!secret || counter === undefined) return reply.code(400).send({ error: "invalid_code" });

      const now = new Date().toISOString();
      const { id } = await db
        .insertInto("users")
        .values({
          username,
          password_hash: await hashPassword(password),
          totp_secret: cipher.encrypt(secret, "totp-secret"),
          totp_last_counter: counter,
          role: "admin",
          created_at: now,
          updated_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      setup.complete();

      await audit(db, { action: "auth.setup", target: username, userId: id });
      setSessionCookie(reply, await createSession(db, id), basePath);
      return { username, role: "admin" as const };
    },
  );

  app.post(
    "/login",
    {
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "Log in with password and TOTP code",
        body: Type.Object({
          username: Type.String({ maxLength: 64 }),
          password: Type.String({ maxLength: 256 }),
          code: Code,
        }),
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
      const counter =
        passwordOk && user?.totp_secret
          ? verifyTotp(cipher.decrypt(user.totp_secret, "totp-secret"), code, Date.now(), user.totp_last_counter ?? -1)
          : undefined;

      if (!user || counter === undefined) {
        await audit(db, { action: "auth.login", target: username, details: { ok: false } });
        // One answer for every failure: do not reveal whether the user, password or code was wrong.
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      await db.updateTable("users").set({ totp_last_counter: counter }).where("id", "=", user.id).execute();
      await audit(db, { action: "auth.login", target: username, userId: user.id, details: { ok: true } });
      setSessionCookie(reply, await createSession(db, user.id), basePath);
      return { username: user.username, role: user.role };
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
};
