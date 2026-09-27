import type { Static, TSchema } from "typebox";
import Value from "typebox/value";
import { expect } from "vitest";

/** Asserts that `value` matches `schema`, listing every violation on failure. */
export function expectSchema<T extends TSchema>(schema: T, value: unknown): asserts value is Static<T> {
  const errors = Value.Errors(schema, value).map((e) => `${e.instancePath || "/"} ${e.message}`);
  expect(errors).toEqual([]);
}

export async function expectAdapterError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "AdapterError", code });
}
