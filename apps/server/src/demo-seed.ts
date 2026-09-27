import { DEMO_ACCOUNTS } from "@wickwatch/adapter-demo";
import type { ChallengeProfile } from "@wickwatch/core";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);

/** Example challenge profiles for the two demo prop accounts; neutral values, not a real firm. */
function demoProfiles(): Record<string, ChallengeProfile> {
  const dailyLoss = {
    reference: "balance-or-equity-at-day-start",
    resetTime: "00:00",
    timezone: "Europe/Berlin",
  } as const;
  return {
    "1111111": {
      name: "Demo Prop A Challenge",
      phase: "Phase 1",
      startDate: isoDay(5),
      startBalance: 100_000,
      rules: {
        profitTargetPct: 10,
        dailyLoss: { ...dailyLoss, limitPct: 5 },
        maxLoss: { limitPct: 10, type: "static" },
        minTradingDays: 4,
        durationDays: 30,
      },
    },
    "2222222": {
      name: "Demo Prop B Challenge",
      phase: "Phase 1",
      startDate: isoDay(2),
      startBalance: 50_000,
      rules: {
        profitTargetPct: 8,
        dailyLoss: { ...dailyLoss, limitPct: 4 },
        maxLoss: { limitPct: 8, type: "static" },
        minTradingDays: 3,
      },
    },
  };
}

/** Adds the demo challenge profiles once, when no profile exists yet. */
export async function seedDemoChallenges(db: Db): Promise<boolean> {
  if (await db.selectFrom("challenge_profiles").select("account_id").limit(1).executeTakeFirst()) return false;
  const now = new Date().toISOString();
  let added = false;
  for (const [number, profile] of Object.entries(demoProfiles())) {
    const account = await db
      .selectFrom("accounts")
      .select("id")
      .where("adapter", "=", "demo")
      .where("number", "=", number)
      .executeTakeFirst();
    if (!account) continue;
    await db
      .insertInto("challenge_profiles")
      .values({
        account_id: account.id,
        template_id: null,
        profile: JSON.stringify(profile),
        created_at: now,
        updated_at: now,
      })
      .execute();
    added = true;
  }
  return added;
}
