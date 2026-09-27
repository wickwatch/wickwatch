import { isAdapterError } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { audit } from "../services/audit";

const Action = Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart")]);

export const instanceRoutes: FastifyPluginAsyncTypebox<{ adapters: Adapters; db: Db }> = async (
  app,
  { adapters, db },
) => {
  app.post(
    "/instances/:ref/:action",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Start, stop or restart an instance",
        params: Type.Object({ ref: Type.String({ minLength: 1 }), action: Action }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody, 502: ErrorBody, 503: ErrorBody },
      },
    },
    async (request, reply) => {
      const { ref, action } = request.params;
      const userId = request.user?.id;
      try {
        await adapters.runtime[action](ref);
        await audit(db, { action: `instance.${action}`, target: ref, details: { ok: true }, userId });
      } catch (error) {
        const code = isAdapterError(error) ? error.code : "internal";
        await audit(db, { action: `instance.${action}`, target: ref, details: { ok: false, error: code }, userId });
        throw error;
      }
      return reply.code(204).send(null);
    },
  );
};
