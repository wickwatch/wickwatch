import { HostStatus, Overview } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Adapters } from "../adapters";
import { loadOverview } from "../services/overview";

export const overviewRoutes: FastifyPluginAsyncTypebox<{ adapters: Adapters; labelPrefix: string }> = async (
  app,
  { adapters, labelPrefix },
) => {
  app.get(
    "/overview",
    {
      schema: {
        tags: ["overview"],
        summary: "Accounts, instances and alerts for the overview screen",
        response: { 200: Overview },
      },
    },
    async (request) => loadOverview(adapters, labelPrefix, request.log),
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
