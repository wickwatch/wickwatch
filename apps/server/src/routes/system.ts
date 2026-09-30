import { SystemInfo } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Adapters } from "../adapters";
import type { Config } from "../config";

export const systemRoutes: FastifyPluginAsyncTypebox<{ config: Config; adapters: Adapters; version: string }> = async (
  app,
  { config, adapters, version },
) => {
  app.get(
    "/system",
    { schema: { tags: ["system"], summary: "Version, adapters and capabilities", response: { 200: SystemInfo } } },
    async () => ({
      version,
      defaultLocale: config.defaultLocale,
      labelPrefix: config.labelPrefix,
      adapters: { runtime: adapters.runtime.id, broker: adapters.broker.id, config: adapters.config.id },
      capabilities: adapters.broker.capabilities(),
      ...(adapters.broker.periods ? { periods: adapters.broker.periods() } : {}),
      ...(adapters.broker.defaultPeriod ? { defaultPeriod: adapters.broker.defaultPeriod } : {}),
      algoFormats: adapters.broker.algoFormats(),
      parameterFormats: adapters.config.formats(),
    }),
  );
};
