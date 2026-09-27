import type { Credentials } from "@wickwatch/core";

/** A broker account known to Wickwatch, with a way to get its (decrypted) credentials. */
export interface AccountEntry {
  number: string;
  displayName: string;
  credentialLabel?: string;
  credentials(): Promise<Credentials>;
}

/** Source of the configured accounts: the demo data for now, the database later. */
export interface AccountDirectory {
  list(): Promise<AccountEntry[]>;
}

export async function findAccount(directory: AccountDirectory, number: string): Promise<AccountEntry | undefined> {
  return (await directory.list()).find((a) => a.number === number);
}
