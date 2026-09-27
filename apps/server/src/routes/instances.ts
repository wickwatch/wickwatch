import { InstanceDetail, isAdapterError } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { audit } from "../services/audit";
import { loadInstanceDetail } from "../services/instance-detail";

const Action = Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart")]);
const Ref = Type.String({ minLength: 1, maxLength: 200 });
const KEEP_ALIVE_MS = 15_000;

export interface InstanceRouteOptions {
  adapters: Adapters;
  accounts: AccountDirectory;
  db: Db;
  labelPrefix: string;
}

export const instanceRoutes: FastifyPluginAsyncTypebox<InstanceRouteOptions> = async (
  app,
  { adapters, accounts, db, labelPrefix },
) => {
  app.get(
    "/instances/:ref",
    {
      schema: {
        tags: ["instances"],
        summary: "Instance detail: status, positions, orders, deals and key figures of the range",
        params: Type.Object({ ref: Ref }),
        querystring: Type.Object({ days: Type.Optional(Type.Integer({ minimum: 1, maximum: 366, default: 30 })) }),
        response: { 200: InstanceDetail, 404: ErrorBody, 503: ErrorBody },
      },
    },
    async (request) =>
      loadInstanceDetail(
        adapters,
        accounts,
        db,
        labelPrefix,
        request.params.ref,
        request.query.days ?? 30,
        request.log,
      ),
  );

  app.get(
    "/instances/:ref/logs/stream",
    {
      schema: {
        tags: ["instances"],
        summary: "Live log as Server-Sent Events",
        description:
          "Sends the last `tail` lines, then new lines as they appear. Each event is `event: log` with a LogLine as JSON; " +
          "comment lines keep the connection open. Stream errors arrive as `event: error` with `{ error }`.",
        params: Type.Object({ ref: Ref }),
        querystring: Type.Object({ tail: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000, default: 200 })) }),
        response: { 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const { ref } = request.params;
      if (!(await adapters.runtime.list()).some((i) => i.ref === ref)) {
        return reply.code(404).send({ error: "not_found" });
      }

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // nginx and others must not buffer the stream.
        "x-accel-buffering": "no",
      });
      res.write("retry: 5000\n\n");

      const controller = new AbortController();
      const ping = setInterval(() => res.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
      request.raw.on("close", () => {
        controller.abort();
      });

      try {
        const lines = adapters.runtime.logs(ref, {
          tail: request.query.tail ?? 200,
          follow: true,
          signal: controller.signal,
        });
        for await (const line of lines) res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
      } catch (error) {
        if (!controller.signal.aborted) {
          request.log.warn({ err: error, ref }, "Log stream failed");
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: isAdapterError(error) ? error.code : "internal" })}\n\n`,
          );
        }
      } finally {
        clearInterval(ping);
        res.end();
      }
    },
  );

  app.post(
    "/instances/:ref/:action",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["instances"],
        summary: "Start, stop or restart an instance",
        params: Type.Object({ ref: Ref, action: Action }),
        response: { 204: Type.Null(), 403: ErrorBody, 404: ErrorBody, 501: ErrorBody, 502: ErrorBody, 503: ErrorBody },
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
