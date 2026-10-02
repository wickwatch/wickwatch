import { ApiToken, CreatedApiToken } from "@wickwatch/core";
import { API_TOKEN_EXPIRY_DAYS } from "@wickwatch/core/rules";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { createApiToken, deleteApiToken, listApiTokens } from "../auth/api-tokens";
import type { Db } from "../db";
import { actor, requireAdmin, requireSession } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import type { Cipher } from "../security/cipher";
import { verifyPassword } from "../security/password";
import { verifyTotp } from "../security/totp";
import { audit } from "../services/audit";
import type { SecurityNotifier } from "../services/security-notice";

/** Admins manage the tokens in the web app; a token cannot list, create or delete tokens itself. */
const guard = [requireAdmin, requireSession];

export interface ApiTokenRouteOptions {
  db: Db;
  cipher: Cipher | undefined;
  notify?: SecurityNotifier | undefined;
  /** API_TOKENS_REQUIRE_2FA: only users with 2FA may create tokens. */
  require2fa: boolean;
}

// Creating a token checks the password (and code): slow down guessing, as at login.
const limited = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export const apiTokenRoutes: FastifyPluginAsyncTypebox<ApiTokenRouteOptions> = async (
  app,
  { db, cipher, notify, require2fa },
) => {
  app.get(
    "/api-tokens",
    {
      preHandler: guard,
      schema: {
        tags: ["auth"],
        summary: "API tokens, newest first (admins, with a session)",
        security: [{ session: [] }],
        response: { 200: Type.Array(ApiToken), 403: ErrorBody },
      },
    },
    async () => listApiTokens(db),
  );

  app.post(
    "/api-tokens",
    {
      preHandler: guard,
      config: limited,
      schema: {
        tags: ["auth"],
        summary: "Create an API token; the answer holds the token, which is not shown again",
        description:
          "Send it as `Authorization: Bearer <token>`. A request with it acts as the creating user, with at most the " +
          "token's role. Without `expiresInDays` it does not expire. Needs the user's password and, with 2FA on, a " +
          "current code, so a session left open cannot mint lasting access: wrong password 403 `invalid_password`, " +
          "missing code 401 `totp_required`, wrong or used code 401 `invalid_credentials`. With " +
          "API_TOKENS_REQUIRE_2FA=on a user without 2FA gets 403 `totp_needed`.",
        security: [{ session: [] }],
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 64, pattern: "\\S" }),
          role: Type.Union([Type.Literal("admin"), Type.Literal("viewer")]),
          expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: Math.max(...API_TOKEN_EXPIRY_DAYS) })),
          password: Type.String({ maxLength: 256 }),
          code: Type.Optional(Type.String({ minLength: 6, maxLength: 8 })),
        }),
        response: { 201: CreatedApiToken, 401: ErrorBody, 403: ErrorBody, 429: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { role, expiresInDays, password, code } = request.body;
      const name = request.body.name.trim();
      const userId = request.user?.id ?? 0;

      const user = await db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirstOrThrow();
      const fail = async (status: 401 | 403, error: string) => {
        await audit(db, { action: "api_token.create", target: name, ...actor(request), details: { ok: false, error } });
        return reply.code(status).send({ error });
      };
      if (require2fa && !user.totp_secret) return fail(403, "totp_needed");
      if (!(await verifyPassword(password, user.password_hash))) return fail(403, "invalid_password");
      if (user.totp_secret) {
        if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
        if (code === undefined) return fail(401, "totp_required");
        // As at login, including the replay protection: a code counts once.
        const secret = cipher.decrypt(user.totp_secret, "totp-secret");
        const counter = verifyTotp(secret, code, Date.now(), user.totp_last_counter ?? -1);
        if (counter === undefined) return fail(401, "invalid_credentials");
        await db.updateTable("users").set({ totp_last_counter: counter }).where("id", "=", user.id).execute();
      }

      const created = await createApiToken(db, { name, role, userId, expiresInDays });
      await audit(db, {
        action: "api_token.create",
        target: name,
        ...actor(request),
        details: { ok: true, id: created.id, role, expiresInDays: expiresInDays ?? null },
      });
      notify?.(created);
      return reply.code(201).send(created);
    },
  );

  app.delete(
    "/api-tokens/:id",
    {
      preHandler: guard,
      schema: {
        tags: ["auth"],
        summary: "Delete an API token; requests with it fail from now on",
        security: [{ session: [] }],
        params: Type.Object({ id: Type.Integer() }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const name = await deleteApiToken(db, request.params.id);
      if (name === undefined) return reply.code(404).send({ error: "not_found" });
      await audit(db, {
        action: "api_token.delete",
        target: name,
        ...actor(request),
        details: { id: request.params.id },
      });
      return reply.code(204).send(null);
    },
  );
};
