import { Readable } from "node:stream";
import { errorCode, InstanceDetail, LogPeriod, type LogLine } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { AccountDirectory } from "../accounts";
import type { Adapters } from "../adapters";
import type { Db } from "../db";
import { actor, requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { auditOutcome } from "../services/audit";
import { setShouldRun } from "../services/instance-keeper";
import type { DealHistory } from "../services/deal-history";
import type { LogTracker } from "../services/log-tracker";
import { loadInstanceDetail } from "../services/instance-detail";

const Action = Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("restart")]);
/**
 * The ref reaches the runtime unchanged (for a container runtime inside the path of an API call), so only the characters
 * of a container name: no slashes, and no dot or dash at the start.
 */
export const Ref = Type.String({ minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]*$" });
const KEEP_ALIVE_MS = 15_000;
const HOUR_MS = 60 * 60 * 1000;
const PERIOD_MS = { "24h": 24 * HOUR_MS, "7d": 7 * 24 * HOUR_MS } as const;
/** A download line: the UTC time, then the text as the instance wrote it. */
const fileLine = (line: LogLine) => `${line.time} ${line.text}\n`;

export interface InstanceRouteOptions {
  adapters: Adapters;
  accounts: AccountDirectory;
  db: Db;
  labelPrefix: string;
  logTracker: LogTracker;
  history: DealHistory;
}

export const instanceRoutes: FastifyPluginAsyncTypebox<InstanceRouteOptions> = async (
  app,
  { adapters, accounts, db, labelPrefix, logTracker, history },
) => {
  app.get(
    "/instances/:ref",
    {
      schema: {
        tags: ["instances"],
        summary: "Instance detail: status, positions, orders, deals and key figures of the range",
        params: Type.Object({ ref: Ref }),
        querystring: Type.Object({
          days: Type.Optional(Type.Integer({ minimum: 1, maximum: 366, default: 30 })),
          all: Type.Optional(
            Type.Boolean({ description: "Everything since the instance's first trade; `days` is then ignored." }),
          ),
        }),
        response: { 200: InstanceDetail, 404: ErrorBody, 503: ErrorBody },
      },
    },
    async (request) =>
      loadInstanceDetail(
        adapters,
        accounts,
        db,
        labelPrefix,
        logTracker,
        history,
        request.params.ref,
        request.query.all ? "all" : (request.query.days ?? 30),
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
          res.write(`event: error\ndata: ${JSON.stringify({ error: errorCode(error) })}\n\n`);
        }
      } finally {
        clearInterval(ping);
        res.end();
      }
    },
  );

  app.get(
    "/instances/:ref/logs/download",
    {
      schema: {
        tags: ["instances"],
        summary: "The log as a text file",
        description:
          "One line per log line: the UTC time, then the text as the instance wrote it. `period` limits it to the last " +
          "24 hours or 7 days; `all` is everything the runtime still has. Streamed, so a long log never sits in memory.",
        params: Type.Object({ ref: Ref }),
        querystring: Type.Object({ period: Type.Optional(LogPeriod) }),
        response: { 404: ErrorBody },
      },
    },
    async (request, reply) => {
      const { ref } = request.params;
      if (!(await adapters.runtime.list()).some((i) => i.ref === ref)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const period = request.query.period ?? "24h";
      const now = new Date();
      const since = period === "all" ? undefined : new Date(now.getTime() - PERIOD_MS[period]).toISOString();
      const lines = adapters.runtime.logs(ref, { tail: "all", ...(since ? { since } : {}) })[Symbol.asyncIterator]();
      // Read the first line before answering: a runtime that fails answers with its error, not a cut-off file.
      const first = await lines.next();
      async function* text() {
        try {
          for (let next = first; !next.done; next = await lines.next()) yield fileLine(next.value);
        } finally {
          await lines.return?.();
        }
      }
      // The ref holds only file name characters (see Ref).
      const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
      return (
        reply
          .type("text/plain; charset=utf-8")
          .header("content-disposition", `attachment; filename="${ref}-${stamp}.log"`)
          // No response schema for 200 on purpose, as for the parameter file: the text goes out as it is.
          .send(Readable.from(text()) as never)
      );
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
      await auditOutcome(db, { action: `instance.${action}`, target: ref, ...actor(request) }, async () => {
        // Before stopping, so the instance keeper does not see it ended while still "meant to run".
        if (action === "stop") await setShouldRun(db, ref, false, true);
        await adapters.runtime[action](ref);
        if (action !== "stop") await setShouldRun(db, ref, true);
      });
      return reply.code(204).send(null);
    },
  );
};
