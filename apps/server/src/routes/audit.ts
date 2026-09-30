import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";

const AuditRecord = Type.Object({
  id: Type.Integer(),
  time: Type.String(),
  /** The user who acted; missing for Wickwatch itself (loss guard, autostart) and failed logins. */
  user: Type.Optional(Type.String()),
  action: Type.String(),
  target: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const MAX_LIMIT = 200;

/** The audit log, newest first, for admins: who did what and what Wickwatch did by itself. */
export const auditRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/audit",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["system"],
        summary: "Audit log entries, newest first (admins)",
        description:
          "`action` filters by exact action or, ending in a dot, by prefix (`instance.`); `target` by part of the target. `before` pages back: pass the smallest `id` of the previous page.",
        querystring: Type.Object({
          action: Type.Optional(Type.String({ maxLength: 100 })),
          target: Type.Optional(Type.String({ maxLength: 200 })),
          before: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
        }),
        response: {
          200: Type.Object({
            entries: Type.Array(AuditRecord),
            /** More entries exist before the last one. */
            more: Type.Boolean(),
            /** Every action in the log, for the filter. */
            actions: Type.Array(Type.String()),
          }),
          403: ErrorBody,
        },
      },
    },
    async (request) => {
      const { action, target, before } = request.query;
      const limit = request.query.limit ?? 100;
      const rows = await db
        .selectFrom("audit_log")
        .leftJoin("users", "users.id", "audit_log.user_id")
        .select([
          "audit_log.id",
          "audit_log.time",
          "users.username",
          "audit_log.action",
          "audit_log.target",
          "audit_log.details",
        ])
        .$if(action !== undefined && action.endsWith("."), (q) =>
          q.where("audit_log.action", "like", `${action ?? ""}%`),
        )
        .$if(action !== undefined && !action.endsWith("."), (q) => q.where("audit_log.action", "=", action ?? ""))
        .$if(Boolean(target), (q) => q.where("audit_log.target", "like", `%${target ?? ""}%`))
        .$if(before !== undefined, (q) => q.where("audit_log.id", "<", before ?? 0))
        .orderBy("audit_log.id", "desc")
        .limit(limit + 1)
        .execute();
      const actions = await db.selectFrom("audit_log").select("action").distinct().orderBy("action").execute();
      return {
        entries: rows.slice(0, limit).map((r) => {
          let details: Record<string, unknown> | undefined;
          try {
            const parsed: unknown = r.details ? JSON.parse(r.details) : undefined;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
              details = parsed as Record<string, unknown>;
          } catch {
            // An unreadable entry still shows, without details.
          }
          return {
            id: r.id,
            time: r.time,
            ...(r.username ? { user: r.username } : {}),
            action: r.action,
            ...(r.target ? { target: r.target } : {}),
            ...(details ? { details } : {}),
          };
        }),
        more: rows.length > limit,
        actions: actions.map((a) => a.action),
      };
    },
  );
};
