import { EmergencyStopReport, emergencyStopAccount, isAdapterError } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { findAccount } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { ErrorBody } from "../plugins/errors";
import { audit } from "../services/audit";

export const accountRoutes: FastifyPluginAsyncTypebox<{ adapters: Adapters; db: Db; labelPrefix: string }> = async (
  app,
  { adapters, db, labelPrefix },
) => {
  app.post(
    "/accounts/:number/emergency-stop",
    {
      schema: {
        tags: ["accounts"],
        summary: "Stop all instances of the account, cancel pending orders and close all positions",
        description: "Destructive. `confirm` must repeat the account number.",
        params: Type.Object({ number: Type.String({ minLength: 1 }) }),
        body: Type.Object({ confirm: Type.String() }),
        response: { 200: EmergencyStopReport, 400: ErrorBody, 404: ErrorBody, 502: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { number } = request.params;
      if (request.body.confirm !== number) return reply.code(400).send({ error: "confirmation_required" });

      const account = await findAccount(adapters.accounts, number);
      if (!account) return reply.code(404).send({ error: "not_found" });

      try {
        const report = await emergencyStopAccount({
          runtime: adapters.runtime,
          broker: adapters.broker,
          credentials: await account.credentials(),
          account: number,
          labelPrefix,
        });
        await audit(db, { action: "account.emergency_stop", target: number, details: { ok: true, ...report } });
        return report;
      } catch (error) {
        const code = isAdapterError(error) ? error.code : "internal";
        await audit(db, { action: "account.emergency_stop", target: number, details: { ok: false, error: code } });
        throw error;
      }
    },
  );
};
