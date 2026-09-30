import { AdapterError, type Credentials } from "@wickwatch/core";
import type { Db } from "./db";
import type { Cipher } from "./security/cipher";

/** A broker account known to wickwatch, with a way to get its (decrypted) credentials. */
export interface AccountEntry {
  /** Database id. */
  id: number;
  number: string;
  displayName: string;
  broker: string;
  currency: string;
  /** Stored login used for the broker; missing if there is none. */
  credentialId?: number;
  credentialLabel?: string;
  credentials(): Promise<Credentials>;
}

export interface AccountDirectory {
  list(): Promise<AccountEntry[]>;
}

export async function findAccount(directory: AccountDirectory, number: string): Promise<AccountEntry | undefined> {
  return (await directory.list()).find((a) => a.number === number);
}

export async function findAccountById(directory: AccountDirectory, id: number): Promise<AccountEntry | undefined> {
  return (await directory.list()).find((a) => a.id === id);
}

/** Database id of the account with this number. */
export async function findAccountId(directory: AccountDirectory, number: string): Promise<number | undefined> {
  return (await findAccount(directory, number))?.id;
}

/** A stored login with its secret decrypted, for a call to the broker. */
export function decryptCredential(cipher: Cipher, row: { login: string; secret: string }): Credentials {
  return { login: row.login, secret: cipher.decrypt(row.secret, "credential-secret") };
}

/** Accounts of the active broker adapter, stored in the database. Secrets are decrypted only on use. */
export function dbAccountDirectory(db: Db, cipher: Cipher | undefined, brokerId: string): AccountDirectory {
  return {
    async list() {
      const rows = await db
        .selectFrom("accounts")
        .leftJoin("credentials", "credentials.id", "accounts.credential_id")
        .select([
          "accounts.id",
          "accounts.number",
          "accounts.display_name",
          "accounts.broker",
          "accounts.currency",
          "accounts.credential_id",
          "credentials.label as credential_label",
          "credentials.login",
          "credentials.secret",
        ])
        .where("accounts.adapter", "=", brokerId)
        .orderBy("accounts.id")
        .execute();

      return rows.map((row) => ({
        id: row.id,
        number: row.number,
        displayName: row.display_name,
        broker: row.broker,
        currency: row.currency,
        ...(row.credential_id !== null ? { credentialId: row.credential_id } : {}),
        ...(row.credential_label ? { credentialLabel: row.credential_label } : {}),
        credentials: () => {
          const { login, secret } = row;
          if (!cipher) return Promise.reject(new AdapterError("unavailable", "MASTER_KEY is not set"));
          if (login === null || secret === null) {
            return Promise.reject(new AdapterError("auth_failed", `No credentials for account ${row.number}`));
          }
          return Promise.resolve(decryptCredential(cipher, { login, secret }));
        },
      }));
    },
  };
}
