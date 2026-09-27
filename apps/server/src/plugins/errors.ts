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
    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({ error: "internal" });
  });
});
