import { HostStatus, Overview } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import type { LogTracker } from "../services/log-tracker";
import { loadOverview } from "../services/overview";

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
