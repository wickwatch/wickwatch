import { errorCode, isAdapterError, type AdapterErrorCode } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";

/** What a failed broker query shows as; errors other than the adapter's own are logged. */
export function brokerErrorCode(error: unknown, account: string, log: FastifyBaseLogger): AdapterErrorCode {
  if (!isAdapterError(error)) log.error({ err: error, account }, "Broker query failed");
  return errorCode(error, "unavailable");
}
