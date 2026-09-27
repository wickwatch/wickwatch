import Type from "typebox";

export const AdapterErrorCode = Type.Union([
  Type.Literal("auth_failed"),
  Type.Literal("not_found"),
  Type.Literal("unsupported"),
  Type.Literal("invalid_input"),
  Type.Literal("timeout"),
  Type.Literal("unavailable"),
]);
export type AdapterErrorCode = Type.Static<typeof AdapterErrorCode>;

/**
 * Error thrown by adapters. The UI translates `code`; `message` is for logs
 * only and must never contain secrets.
 */
export class AdapterError extends Error {
  override readonly name = "AdapterError";

  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function isAdapterError(error: unknown, code?: AdapterErrorCode): error is AdapterError {
  return error instanceof AdapterError && (code === undefined || error.code === code);
}
