import { ParameterValues, type AttributionMode, type InstanceConfig } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import Value from "typebox/value";
import { findAccountById, type AccountDirectory } from "../accounts";
import type { Db } from "../db";
import type { InstanceConfigsTable } from "../db/schema";
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

export type ConfigRow = Omit<InstanceConfigsTable, "id" | "instance_id"> & { created_by_name?: string | null };

/** Without the master key, encrypted parameter values cannot be read and are left out. */
export function toConfig(row: ConfigRow, cipher: Cipher | undefined): InstanceConfig {
  const json = decryptParameters(cipher, row.parameters);
  const parameters: unknown = json === undefined ? {} : JSON.parse(json);
  return {
    version: row.version,
    algo: { id: row.algo_id, name: row.algo_name, version: row.algo_version },
    symbol: row.symbol,
    period: row.period,
    parameters: Value.Check(ParameterValues, parameters) ? parameters : {},
    attribution: {
      mode: row.attribution as AttributionMode,
      ...(row.order_label ? { orderLabel: row.order_label } : {}),
    },
    ...(row.comment ? { comment: row.comment } : {}),
    createdAt: row.created_at,
    ...(row.created_by_name ? { createdBy: row.created_by_name } : {}),
  };
}

/** Configuration versions with the name of who saved them. */
export const configQuery = (db: Db) =>
  db
    .selectFrom("instance_configs")
    .leftJoin("users", "users.id", "instance_configs.created_by")
    .select([
      "instance_configs.instance_id",
      "instance_configs.version",
      "instance_configs.algo_id",
      "instance_configs.algo_name",
      "instance_configs.algo_version",
      "instance_configs.symbol",
      "instance_configs.period",
      "instance_configs.parameters",
      "instance_configs.attribution",
      "instance_configs.order_label",
      "instance_configs.comment",
      "instance_configs.created_by",
      "instance_configs.created_at",
      "users.username as created_by_name",
    ]);

/**
 * One configuration version of the instance with this name, the current one without `version`. Undefined when there
 * is none or the instance belongs to an account of another broker adapter.
 */
export async function loadConfigVersion(
  { db, accounts, cipher }: { db: Db; accounts: AccountDirectory; cipher: Cipher },
  name: string,
  version?: number,
): Promise<InstanceConfig | undefined> {
  let query = configQuery(db)
    .innerJoin("instances", "instances.id", "instance_configs.instance_id")
    .select("instances.account_id")
    .where("instances.name", "=", name)
    .orderBy("instance_configs.version", "desc")
    .limit(1);
  if (version !== undefined) query = query.where("instance_configs.version", "=", version);
  const row = await query.executeTakeFirst();
  if (!row || !(await findAccountById(accounts, row.account_id))) return undefined;
  return toConfig(row, cipher);
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
