import { DEMO_ACCOUNTS } from "@wickwatch/adapter-demo";
import type { Db } from "./db";
import type { Cipher } from "./security/cipher";

/** Fills an empty database with the demo accounts, so the demo works right after setup. */
export async function seedDemoAccounts(db: Db, cipher: Cipher): Promise<boolean> {
  const existing = await db.selectFrom("accounts").select("id").limit(1).executeTakeFirst();
  if (existing) return false;

  const now = new Date().toISOString();
  const credentialIds = new Map<string, number>();
  for (const label of new Set(DEMO_ACCOUNTS.map((a) => a.credentialLabel))) {
    const { id } = await db
      .insertInto("credentials")
      .values({
        label,
        login: "demo",
        secret: cipher.encrypt("demo", "credential-secret"),
        created_at: now,
        updated_at: now,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    credentialIds.set(label, id);
  }

  await db
    .insertInto("accounts")
    .values(
      DEMO_ACCOUNTS.map((a) => ({
        adapter: "demo",
        number: a.number,
        broker: a.broker,
        currency: a.currency,
        display_name: a.displayName,
        credential_id: credentialIds.get(a.credentialLabel) ?? null,
        timezone: null,
        created_at: now,
        updated_at: now,
      })),
    )
    .execute();
  return true;
}
