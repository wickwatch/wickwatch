import { EmergencyStopReport, emergencyStopAccount, isAdapterError } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { findAccount, type AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import type { Cipher } from "../security/cipher";
import { audit } from "../services/audit";

const Account = Type.Object({
  id: Type.Integer(),
  adapter: Type.String(),
  number: Type.String(),
  broker: Type.String(),
  currency: Type.String(),
  displayName: Type.String(),
  credentialId: Type.Union([Type.Integer(), Type.Null()]),
  timezone: Type.Union([Type.String(), Type.Null()]),
});

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export interface AccountRouteOptions {
  adapters: Adapters;
  accounts: AccountDirectory;
  db: Db;
  cipher: Cipher | undefined;
  labelPrefix: string;
}

export const accountRoutes: FastifyPluginAsyncTypebox<AccountRouteOptions> = async (
  app,
  { adapters, accounts, db, cipher, labelPrefix },
) => {
  app.get(
    "/accounts",
    { schema: { tags: ["accounts"], summary: "Configured broker accounts", response: { 200: Type.Array(Account) } } },
    async () =>
      (await db.selectFrom("accounts").selectAll().orderBy("id").execute()).map((a) => ({
        id: a.id,
        adapter: a.adapter,
        number: a.number,
        broker: a.broker,
        currency: a.currency,
        displayName: a.display_name,
        credentialId: a.credential_id,
        timezone: a.timezone,
      })),
  );

  app.post(
    "/accounts",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Add an account; it is looked up at the broker with the given credentials",
        body: Type.Object({
          number: Type.String({ minLength: 1, maxLength: 64 }),
          displayName: Type.String({ minLength: 1, maxLength: 100 }),
          credentialId: Type.Integer(),
          timezone: Type.Optional(Type.String()),
        }),
        response: { 201: Account, 400: ErrorBody, 403: ErrorBody, 409: ErrorBody, 502: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { number, displayName, credentialId, timezone } = request.body;
      if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
      if (timezone !== undefined && !isTimeZone(timezone)) return reply.code(400).send({ error: "invalid_timezone" });

      const credential = await db
        .selectFrom("credentials")
        .selectAll()
        .where("id", "=", credentialId)
        .executeTakeFirst();
      if (!credential) return reply.code(400).send({ error: "credential_not_found" });

      const brokerId = adapters.broker.id;
      const duplicate = await db
        .selectFrom("accounts")
        .select("id")
        .where("adapter", "=", brokerId)
        .where("number", "=", number)
        .executeTakeFirst();
      if (duplicate) return reply.code(409).send({ error: "account_exists" });

      const found = (
        await adapters.broker.accounts({
          login: credential.login,
          secret: cipher.decrypt(credential.secret, "credential-secret"),
        })
      ).find((a) => a.number === number);
      if (!found) return reply.code(400).send({ error: "account_not_found_at_broker" });

      const now = new Date().toISOString();
      const row = {
        adapter: brokerId,
        number,
        broker: found.broker,
        currency: found.currency,
        display_name: displayName,
        credential_id: credentialId,
        timezone: timezone ?? null,
        created_at: now,
        updated_at: now,
      };
      const { id } = await db.insertInto("accounts").values(row).returning("id").executeTakeFirstOrThrow();
      await audit(db, { action: "account.create", target: number, userId: request.user?.id });
      return reply.code(201).send({
        id,
        adapter: brokerId,
        number,
        broker: found.broker,
        currency: found.currency,
        displayName,
        credentialId,
        timezone: row.timezone,
      });
    },
  );

  app.delete(
    "/accounts/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Remove an account from Wickwatch (nothing changes at the broker)",
        params: Type.Object({ id: Type.Integer() }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const account = await db
        .selectFrom("accounts")
        .select("number")
        .where("id", "=", request.params.id)
        .executeTakeFirst();
      if (!account) return reply.code(404).send({ error: "not_found" });
      await db.deleteFrom("accounts").where("id", "=", request.params.id).execute();
      await audit(db, { action: "account.delete", target: account.number, userId: request.user?.id });
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/accounts/:number/emergency-stop",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Stop all instances of the account, cancel pending orders and close all positions",
        description: "Destructive. `confirm` must repeat the account number.",
        params: Type.Object({ number: Type.String({ minLength: 1 }) }),
        body: Type.Object({ confirm: Type.String() }),
        response: {
          200: EmergencyStopReport,
          400: ErrorBody,
          403: ErrorBody,
          404: ErrorBody,
          502: ErrorBody,
          503: ErrorBody,
        },
      },
    },
    async (request, reply) => {
      const { number } = request.params;
      if (request.body.confirm !== number) return reply.code(400).send({ error: "confirmation_required" });

      const account = await findAccount(accounts, number);
      if (!account) return reply.code(404).send({ error: "not_found" });

      const userId = request.user?.id;
      try {
        const report = await emergencyStopAccount({
          runtime: adapters.runtime,
          broker: adapters.broker,
          credentials: await account.credentials(),
          account: number,
          labelPrefix,
        });
        await audit(db, { action: "account.emergency_stop", target: number, details: { ok: true, ...report }, userId });
        return report;
      } catch (error) {
        const code = isAdapterError(error) ? error.code : "internal";
        await audit(db, {
          action: "account.emergency_stop",
          target: number,
          details: { ok: false, error: code },
          userId,
        });
        throw error;
      }
    },
  );
};
