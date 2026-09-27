import { AdapterError, type AdapterErrorCode } from "@wickwatch/core";
import fp from "fastify-plugin";
import Type from "typebox";

/** Error body of every API error; `error` is a code the UI translates. */
export const ErrorBody = Type.Object({ error: Type.String(), message: Type.Optional(Type.String()) });

const STATUS: Record<AdapterErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  unsupported: 501,
  // The broker rejected the stored credentials; not the caller's authentication.
  auth_failed: 502,
  unavailable: 503,
  timeout: 504,
};

export const errors = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AdapterError) {
      request.log.warn({ code: error.code, msg: error.message }, "Adapter error");
      return reply.code(STATUS[error.code]).send({ error: error.code });
    }
    if (error instanceof Error && "validation" in error) {
      return reply.code(400).send({ error: "invalid_input", message: error.message });
    }
    // Fastify and plugin errors such as 413, 415 or 429 (rate limit) keep their status.
    const status =
      typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: status === 429 ? "rate_limited" : "invalid_input" });
    }
    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({ error: "internal" });
  });
});
