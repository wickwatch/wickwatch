import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import type { Cipher } from "../security/cipher";
import { audit } from "../services/audit";

/** Never contains the secret. */
const Credential = Type.Object({
  id: Type.Integer(),
  label: Type.String(),
  login: Type.String(),
  createdAt: Type.String(),
});

export const credentialRoutes: FastifyPluginAsyncTypebox<{ db: Db; cipher: Cipher | undefined }> = async (
  app,
  { db, cipher },
) => {
  app.get(
    "/credentials",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Stored broker logins (without secrets)",
        response: { 200: Type.Array(Credential), 403: ErrorBody },
      },
    },
    async () =>
      (await db.selectFrom("credentials").select(["id", "label", "login", "created_at"]).orderBy("id").execute()).map(
        (c) => ({ id: c.id, label: c.label, login: c.login, createdAt: c.created_at }),
      ),
  );

  app.post(
    "/credentials",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Store a broker login; the secret is encrypted with MASTER_KEY",
        body: Type.Object({
          label: Type.String({ minLength: 1, maxLength: 100 }),
          login: Type.String({ minLength: 1, maxLength: 200 }),
          secret: Type.String({ minLength: 1, maxLength: 1000 }),
        }),
        response: { 201: Credential, 403: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const { label, login, secret } = request.body;
      const now = new Date().toISOString();
      const { id } = await db
        .insertInto("credentials")
        .values({ label, login, secret: cipher.encrypt(secret, "credential-secret"), created_at: now, updated_at: now })
        .returning("id")
        .executeTakeFirstOrThrow();
      await audit(db, {
        action: "credential.create",
        target: String(id),
        details: { label },
        userId: request.user?.id,
      });
      return reply.code(201).send({ id, label, login, createdAt: now });
    },
  );

  app.delete(
    "/credentials/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Delete a stored login that no account uses",
        params: Type.Object({ id: Type.Integer() }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const used = await db.selectFrom("accounts").select("id").where("credential_id", "=", id).executeTakeFirst();
      if (used) return reply.code(409).send({ error: "credential_in_use" });
      const result = await db.deleteFrom("credentials").where("id", "=", id).executeTakeFirst();
      if (result.numDeletedRows === 0n) return reply.code(404).send({ error: "not_found" });
      await audit(db, { action: "credential.delete", target: String(id), userId: request.user?.id });
      return reply.code(204).send(null);
    },
  );
};
