import type { ParameterValues } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";
import type { Cipher } from "../security/cipher";

/** Subquery: the id of each instance's current (latest) configuration version. */
export const latestConfigIds = (db: Db) =>
  db
    .selectFrom("instance_configs")
    .select((eb) => eb.fn.max("id").as("id"))
    .groupBy("instance_id");

/** JSON with sorted keys, so equal parameter sets compare equal. */
export const canonicalParameters = (values: ParameterValues) =>
  JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))));

// Parameter values may hold licence keys, so `instance_configs.parameters` is encrypted with the master key.
// Rows written before that hold the JSON object itself, recognisable by its `{`.
const PURPOSE = "instance-parameters";
const isPlaintext = (stored: string) => stored.startsWith("{");

/** The stored form of a configuration's parameter values (JSON). */
export const encryptParameters = (cipher: Cipher, json: string) => cipher.encrypt(json, PURPOSE);

/** The JSON of stored parameter values; undefined when they are encrypted and there is no key to read them. */
export function decryptParameters(cipher: Cipher | undefined, stored: string): string | undefined {
  if (isPlaintext(stored)) return stored;
  return cipher?.decrypt(stored, PURPOSE);
}

/** Encrypts parameter values stored in plaintext by earlier versions; run at start. Returns how many rows it changed. */
export async function encryptStoredParameters(
  db: Db,
  cipher: Cipher,
  log?: Pick<FastifyBaseLogger, "info">,
): Promise<number> {
  const rows = await db
    .selectFrom("instance_configs")
    .select(["id", "parameters"])
    .where("parameters", "like", "{%")
    .execute();
  if (!rows.length) return 0;
  await db.transaction().execute(async (trx) => {
    for (const row of rows) {
      await trx
        .updateTable("instance_configs")
        .set({ parameters: encryptParameters(cipher, row.parameters) })
        .where("id", "=", row.id)
        .execute();
    }
  });
  log?.info({ versions: rows.length }, "Instance parameters encrypted");
  return rows.length;
}
