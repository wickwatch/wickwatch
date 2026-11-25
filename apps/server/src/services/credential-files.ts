import { AdapterError, type Credentials } from "@wickwatch/core";
import type { Adapters } from "../adapters";
import type { Db } from "../db";

export interface CredentialFilesResult {
  /** Instances that hold the new secret now. */
  written: string[];
  /** Instances whose files could not be written; they still log in with the old secret. */
  failed: string[];
}

/**
 * Writes the files holding a login's secret (`BrokerAdapter.credentialFiles`) into the managed instances of the
 * accounts using it, running or not, so their next start logs in with the new secret instead of failing on the old
 * one. Instances not deployed are skipped: their deploy writes the files.
 */
export async function writeCredentialFiles(
  db: Db,
  adapters: Pick<Adapters, "broker" | "runtime">,
  credentialId: number,
  credentials: Credentials,
): Promise<CredentialFilesResult> {
  const result: CredentialFilesResult = { written: [], failed: [] };
  const files = adapters.broker.credentialFiles?.(credentials);
  const writeFiles = adapters.runtime.writeFiles?.bind(adapters.runtime);
  if (!files?.length || !writeFiles) return result;
  const instances = await db
    .selectFrom("instances")
    .innerJoin("accounts", "accounts.id", "instances.account_id")
    .select("instances.name")
    .where("accounts.credential_id", "=", credentialId)
    .where("accounts.adapter", "=", adapters.broker.id)
    .orderBy("instances.name")
    .execute();
  for (const { name } of instances) {
    try {
      await writeFiles(name, files);
      result.written.push(name);
    } catch (error) {
      if (error instanceof AdapterError && error.code === "not_found") continue;
      result.failed.push(name);
    }
  }
  return result;
}
