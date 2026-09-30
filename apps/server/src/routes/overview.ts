import { AccountDetail, CLOCK_TOLERANCE_MS, HostStatus, Overview } from "@wickwatch/core";
import Type from "typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Adapters } from "../adapters";
import { clockCheckState, clockOffset } from "../services/clock-check";
import { ErrorBody } from "../plugins/errors";
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
    async () => {
      const host = await adapters.runtime.hostStatus();
      // Runtimes that cannot see the host's time sync get the measured clock offset instead (services/clock-check.ts).
      if (host.ntpSynced !== undefined) return host;
      const offset = clockOffset();
      if (offset === undefined) {
        const state = clockCheckState();
        return state ? { ...host, clockCheck: state } : host;
      }
      return { ...host, ntpSynced: Math.abs(offset) <= CLOCK_TOLERANCE_MS, clockOffsetMs: offset };
    },
  );
};
