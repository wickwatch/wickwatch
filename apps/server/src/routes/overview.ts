import { AccountDetail, HostStatus, Overview } from "@wickwatch/core";
import Type from "typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import type { LogTracker } from "../services/log-tracker";
import { ErrorBody } from "../plugins/errors";
import { loadAccountDetail, loadOverview } from "../services/overview";

export const overviewRoutes: FastifyPluginAsyncTypebox<{
  adapters: Adapters;
  accounts: AccountDirectory;
  db: Db;
  labelPrefix: string;
  logTracker: LogTracker;
}> = async (app, { adapters, accounts, db, labelPrefix, logTracker }) => {
  app.get(
    "/overview",
    {
      schema: {
        tags: ["overview"],
        summary: "Accounts, instances and alerts for the overview screen",
        response: { 200: Overview },
      },
    },
    async (request) => loadOverview(adapters, accounts, db, labelPrefix, logTracker, request.log),
  );

  app.get(
    "/accounts/:number/detail",
    {
      schema: {
        tags: ["overview"],
        summary: "One account: summary, instances, and all open positions and pending orders with their instance",
        params: Type.Object({ number: Type.String({ minLength: 1, maxLength: 64 }) }),
        response: { 200: AccountDetail, 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const detail = await loadAccountDetail(
        request.params.number,
        adapters,
        accounts,
        db,
        labelPrefix,
        logTracker,
        request.log,
      );
      return detail ?? reply.code(404).send({ error: "not_found" });
    },
  );

  app.get(
    "/host",
    {
      schema: {
        tags: ["overview"],
        summary: "CPU, memory, disk and time sync of the host",
        response: { 200: HostStatus },
      },
    },
    async () => adapters.runtime.hostStatus(),
  );
};
