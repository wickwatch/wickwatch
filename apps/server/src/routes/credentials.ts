import { BrokerAccount } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Adapters } from "../adapters";
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
  /** Number of accounts using this login. */
  accounts: Type.Integer({ minimum: 0 }),
});

const Id = Type.Object({ id: Type.Integer() });

export const credentialRoutes: FastifyPluginAsyncTypebox<{
  db: Db;
  cipher: Cipher | undefined;
  adapters: Adapters;
}> = async (app, { db, cipher, adapters }) => {
  const usage = async (id: number) =>
    Number(
      (
        await db
          .selectFrom("accounts")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("credential_id", "=", id)
          .executeTakeFirstOrThrow()
      ).n,
    );

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
    async () => {
      const rows = await db
        .selectFrom("credentials")
        .select(["id", "label", "login", "created_at"])
        .orderBy("id")
        .execute();
      return Promise.all(
        rows.map(async (c) => ({
          id: c.id,
          label: c.label,
          login: c.login,
          createdAt: c.created_at,
          accounts: await usage(c.id),
        })),
      );
    },
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
      return reply.code(201).send({ id, label, login, createdAt: now, accounts: 0 });
    },
  );

  app.patch(
    "/credentials/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Change label, login or secret of a stored login (e.g. after a password change)",
        params: Id,
        body: Type.Object({
          label: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          login: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          secret: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
        }),
        response: { 200: Credential, 403: ErrorBody, 404: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { label, login, secret } = request.body;
      if (secret !== undefined && !cipher) return reply.code(503).send({ error: "master_key_missing" });
      const now = new Date().toISOString();
      const result = await db
        .updateTable("credentials")
        .set({
          ...(label !== undefined ? { label } : {}),
          ...(login !== undefined ? { login } : {}),
          ...(secret !== undefined && cipher ? { secret: cipher.encrypt(secret, "credential-secret") } : {}),
          updated_at: now,
        })
        .where("id", "=", id)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) return reply.code(404).send({ error: "not_found" });
      // Which fields changed, never their values.
      const changed = Object.keys(request.body).filter((k) => k !== "secret" || secret !== undefined);
      await audit(db, {
        action: "credential.update",
        target: String(id),
        details: { changed },
        userId: request.user?.id,
      });
      const row = await db
        .selectFrom("credentials")
        .select(["id", "label", "login", "created_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      return { id: row.id, label: row.label, login: row.login, createdAt: row.created_at, accounts: await usage(id) };
    },
  );

  app.get(
    "/credentials/:id/broker-accounts",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Accounts the broker offers for this login, and whether they are added already",
        params: Id,
        response: {
          200: Type.Array(Type.Intersect([BrokerAccount, Type.Object({ added: Type.Boolean() })])),
          403: ErrorBody,
          404: ErrorBody,
          502: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      const credential = await db
        .selectFrom("credentials")
        .selectAll()
        .where("id", "=", request.params.id)
        .executeTakeFirst();
      if (!credential) return reply.code(404).send({ error: "not_found" });
      const [offered, added] = await Promise.all([
        adapters.broker.accounts({
          login: credential.login,
          secret: cipher.decrypt(credential.secret, "credential-secret"),
        }),
        db.selectFrom("accounts").select("number").where("adapter", "=", adapters.broker.id).execute(),
      ]);
      const known = new Set(added.map((a) => a.number));
      return offered.map((a) => ({ ...a, added: known.has(a.number) }));
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
