import { AccountDetail, HostStatus, Overview } from "@wickwatch/core";
import Type from "typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Adapters } from "../adapters";
import { ErrorBody } from "../plugins/errors";
import { loadHostStatus } from "../services/host-status";
import type { OverviewLoader } from "../services/overview";

export const overviewRoutes: FastifyPluginAsyncTypebox<{
  adapters: Adapters;
  overview: OverviewLoader;
}> = async (app, { adapters, overview }) => {
  app.get(
    "/overview",
    {
      schema: {
        tags: ["overview"],
        summary: "Accounts, instances and alerts for the overview screen",
        response: { 200: Overview },
      },
    },
    async () => overview.overview(),
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
      const detail = await overview.accountDetail(request.params.number);
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
    async () => loadHostStatus(adapters),
  );
};
