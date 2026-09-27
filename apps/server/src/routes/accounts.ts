import { EmergencyStopReport, emergencyStopAccount, isAdapterError, isTimeZone } from "@wickwatch/core";
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
  /** Label of the login (never the secret), so viewers can see which login an account uses. */
  credentialLabel: Type.Union([Type.String(), Type.Null()]),
  timezone: Type.Union([Type.String(), Type.Null()]),
  hasChallenge: Type.Boolean(),
});
type Account = Type.Static<typeof Account>;

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
  /** Accounts of the active broker adapter; rows of another adapter (e.g. demo) are not usable. */
  async function loadAccounts(id?: number): Promise<Account[]> {
    let query = db
      .selectFrom("accounts")
      .leftJoin("credentials", "credentials.id", "accounts.credential_id")
      .leftJoin("challenge_profiles", "challenge_profiles.account_id", "accounts.id")
      .select([
        "accounts.id",
        "accounts.adapter",
        "accounts.number",
        "accounts.broker",
        "accounts.currency",
        "accounts.display_name",
        "accounts.credential_id",
        "accounts.timezone",
        "credentials.label as credential_label",
        "challenge_profiles.account_id as challenge_account",
      ])
      .where("accounts.adapter", "=", adapters.broker.id)
      .orderBy("accounts.id");
    if (id !== undefined) query = query.where("accounts.id", "=", id);
    return (await query.execute()).map((a) => ({
      id: a.id,
      adapter: a.adapter,
      number: a.number,
      broker: a.broker,
      currency: a.currency,
      displayName: a.display_name,
      credentialId: a.credential_id,
      credentialLabel: a.credential_label,
      timezone: a.timezone,
      hasChallenge: a.challenge_account !== null,
    }));
  }

  /** Whether the broker shows this account for the given stored login. */
  async function brokerKnows(credentialId: number, number: string) {
    const credential = await db.selectFrom("credentials").selectAll().where("id", "=", credentialId).executeTakeFirst();
    if (!credential || !cipher) return { credential, found: undefined };
    const offered = await adapters.broker.accounts({
      login: credential.login,
      secret: cipher.decrypt(credential.secret, "credential-secret"),
    });
    return { credential, found: offered.find((a) => a.number === number) };
  }

  async function loadAccount(id: number): Promise<Account> {
    const [account] = await loadAccounts(id);
    if (!account) throw new Error(`Account ${String(id)} not found after write`);
    return account;
  }

  app.get(
    "/accounts",
    {
      schema: {
        tags: ["accounts"],
        summary: "Configured accounts of the active broker adapter",
        response: { 200: Type.Array(Account) },
      },
    },
    () => loadAccounts(),
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

      const brokerId = adapters.broker.id;
      const duplicate = await db
        .selectFrom("accounts")
        .select("id")
        .where("adapter", "=", brokerId)
        .where("number", "=", number)
        .executeTakeFirst();
      if (duplicate) return reply.code(409).send({ error: "account_exists" });

      const { credential, found } = await brokerKnows(credentialId, number);
      if (!credential) return reply.code(400).send({ error: "credential_not_found" });
      if (!found) return reply.code(400).send({ error: "account_not_found_at_broker" });
      if (found.active === false) return reply.code(400).send({ error: "account_inactive" });

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
      return reply.code(201).send(await loadAccount(id));
    },
  );

  app.patch(
    "/accounts/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Rename an account or switch it to another stored login",
        params: Type.Object({ id: Type.Integer() }),
        body: Type.Object({
          displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          credentialId: Type.Optional(Type.Integer()),
        }),
        response: { 200: Account, 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 502: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { displayName, credentialId } = request.body;
      const account = await db
        .selectFrom("accounts")
        .select(["number", "credential_id"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!account) return reply.code(404).send({ error: "not_found" });
      if (credentialId !== undefined && credentialId !== account.credential_id) {
        if (!cipher) return reply.code(503).send({ error: "master_key_missing" });
        const { credential, found } = await brokerKnows(credentialId, account.number);
        if (!credential) return reply.code(400).send({ error: "credential_not_found" });
        if (!found) return reply.code(400).send({ error: "account_not_found_at_broker" });
      }
      await db
        .updateTable("accounts")
        .set({
          ...(displayName !== undefined ? { display_name: displayName } : {}),
          ...(credentialId !== undefined ? { credential_id: credentialId } : {}),
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", id)
        .execute();
      await audit(db, {
        action: "account.update",
        target: account.number,
        details: { changed: Object.keys(request.body) },
        userId: request.user?.id,
      });
      return loadAccount(id);
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
    "/accounts/:number/positions/:positionId/close",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Close one open position at the broker",
        description: "Destructive. `confirm` must repeat the position id.",
        params: Type.Object({ number: Type.String({ minLength: 1 }), positionId: Type.String({ minLength: 1 }) }),
        body: Type.Object({ confirm: Type.String() }),
        response: { 204: Type.Null(), 400: ErrorBody, 403: ErrorBody, 404: ErrorBody, 502: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { number, positionId } = request.params;
      if (request.body.confirm !== positionId) return reply.code(400).send({ error: "confirmation_required" });
      const account = await findAccount(accounts, number);
      if (!account) return reply.code(404).send({ error: "not_found" });

      const userId = request.user?.id;
      const target = `${number}/${positionId}`;
      try {
        await adapters.broker.closePosition(await account.credentials(), number, positionId);
        await audit(db, { action: "position.close", target, details: { ok: true }, userId });
      } catch (error) {
        const code = isAdapterError(error) ? error.code : "internal";
        await audit(db, { action: "position.close", target, details: { ok: false, error: code }, userId });
        throw error;
      }
      return reply.code(204).send(null);
    },
  );

  const PositionParams = Type.Object({
    number: Type.String({ minLength: 1 }),
    positionId: Type.String({ minLength: 1 }),
  });
  const accountId = async (number: string) =>
    (await db.selectFrom("accounts").select("id").where("number", "=", number).executeTakeFirst())?.id;

  app.put(
    "/accounts/:number/positions/:positionId/attribution",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Attribute a position (and its deals) by hand",
        description: "`instance: null` means the position belongs to no instance, e.g. a manual trade.",
        params: PositionParams,
        body: Type.Object({ instance: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]) }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const { number, positionId } = request.params;
      const id = await accountId(number);
      if (id === undefined) return reply.code(404).send({ error: "not_found" });
      const row = {
        instance: request.body.instance,
        user_id: request.user?.id ?? null,
        created_at: new Date().toISOString(),
      };
      await db
        .insertInto("attribution_overrides")
        .values({ account_id: id, position_id: positionId, ...row })
        .onConflict((oc) => oc.columns(["account_id", "position_id"]).doUpdateSet(row))
        .execute();
      await audit(db, {
        action: "attribution.set",
        target: `${number}/${positionId}`,
        details: { instance: request.body.instance },
        userId: request.user?.id,
      });
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/accounts/:number/positions/:positionId/attribution",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["accounts"],
        summary: "Remove a manual attribution; the rules decide again",
        params: PositionParams,
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const { number, positionId } = request.params;
      const id = await accountId(number);
      if (id === undefined) return reply.code(404).send({ error: "not_found" });
      await db
        .deleteFrom("attribution_overrides")
        .where("account_id", "=", id)
        .where("position_id", "=", positionId)
        .execute();
      await audit(db, { action: "attribution.clear", target: `${number}/${positionId}`, userId: request.user?.id });
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
