import { sql } from "kysely";
import Type from "typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Db } from "../db";

const Health = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
  version: Type.String(),
});

/** Liveness and readiness for proxies and monitoring: cheap, no auth, checks the database. */
export const healthRoutes: FastifyPluginAsyncTypebox<{ db: Db; version: string }> = async (app, { db, version }) => {
  app.get(
    "/healthz",
    {
      schema: {
        tags: ["system"],
        summary: "Health check",
        response: { 200: Health, 503: Health },
      },
      logLevel: "warn",
    },
    async (_request, reply) => {
      try {
        await sql`select 1`.execute(db);
        return { status: "ok" as const, version };
      } catch (error) {
        app.log.error({ err: error }, "Health check failed: database not reachable");
        return reply.code(503).send({ status: "error", version });
      }
    },
  );
};
