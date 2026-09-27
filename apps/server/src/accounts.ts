import { AdapterError, type Credentials } from "@wickwatch/core";
import type { Db } from "./db";
import type { Cipher } from "./security/cipher";

/** A broker account known to Wickwatch, with a way to get its (decrypted) credentials. */
export interface AccountEntry {
  number: string;
  displayName: string;
  credentialLabel?: string;
  credentials(): Promise<Credentials>;
}

export interface AccountDirectory {
  list(): Promise<AccountEntry[]>;
}

export async function findAccount(directory: AccountDirectory, number: string): Promise<AccountEntry | undefined> {
  return (await directory.list()).find((a) => a.number === number);
}

/** Accounts of the active broker adapter, stored in the database. Secrets are decrypted only on use. */
export function dbAccountDirectory(db: Db, cipher: Cipher | undefined, brokerId: string): AccountDirectory {
  return {
    async list() {
      const rows = await db
        .selectFrom("accounts")
        .leftJoin("credentials", "credentials.id", "accounts.credential_id")
        .select([
          "accounts.number",
          "accounts.display_name",
          "credentials.label as credential_label",
          "credentials.login",
          "credentials.secret",
        ])
        .where("accounts.adapter", "=", brokerId)
        .orderBy("accounts.id")
        .execute();

      return rows.map((row) => ({
        number: row.number,
        displayName: row.display_name,
        ...(row.credential_label ? { credentialLabel: row.credential_label } : {}),
        credentials: () => {
          if (!cipher) return Promise.reject(new AdapterError("unavailable", "MASTER_KEY is not set"));
          if (row.login === null || row.secret === null) {
            return Promise.reject(new AdapterError("auth_failed", `No credentials for account ${row.number}`));
          }
          return Promise.resolve({ login: row.login, secret: cipher.decrypt(row.secret, "credential-secret") });
        },
      }));
    },
  };
}
