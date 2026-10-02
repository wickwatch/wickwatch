import { AuditPage } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { AUDIT_MAX_LIMIT, readAuditLog } from "../services/audit";

/** The audit log, newest first, for admins: who did what and what wickwatch did by itself. */
export const auditRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/audit",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["system"],
        summary: "Audit log entries, newest first (admins)",
        description:
          "`action` filters by exact action or, ending in a dot, by prefix (`instance.`); `target` by part of the target; `since` by time. `before` pages back: pass the smallest `id` of the previous page.",
        querystring: Type.Object({
          action: Type.Optional(Type.String({ maxLength: 100 })),
          target: Type.Optional(Type.String({ maxLength: 200 })),
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          /** Only entries at or after this time (ISO, UTC). */
          since: Type.Optional(Type.String({ format: "date-time" })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: AUDIT_MAX_LIMIT })),
        }),
        response: {
          200: AuditPage,
          403: ErrorBody,
        },
      },
    },
    async (request) => readAuditLog(db, request.query),
  );
};
