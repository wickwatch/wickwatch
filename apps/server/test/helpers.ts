import type { LightMyRequestResponse } from "fastify";
import { createAdapters, type Adapters } from "../src/adapters";
import { buildApp, type App } from "../src/app";
import { SetupState } from "../src/auth/setup";
import { loadConfig } from "../src/config";
import { createDatabase, migrateToLatest, type Db } from "../src/db";
import type { Role } from "../src/db/schema";
import { seedDemoAccounts } from "../src/demo-seed";
import { createCipher, type Cipher } from "../src/security/cipher";
import { hashPassword } from "../src/security/password";
import { generateTotpSecret, totpCode, totpCounter } from "../src/security/totp";

export const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
export const SETUP_TOKEN = "test-setup-token";
export const PASSWORD = "correct horse battery";

export interface TestApp {
  app: App;
  db: Db;
  cipher: Cipher;
  setup: SetupState;
  adapters: Adapters;
}

export async function startApp(
  env: Record<string, string> = {},
  { seed = true, onChallengeSaved }: { seed?: boolean; onChallengeSaved?: (accountId: number) => void } = {},
): Promise<TestApp> {
  const config = loadConfig({ DATABASE_URL: "file::memory:", MASTER_KEY, ...env });
  const db = createDatabase(config.database);
  await migrateToLatest(db);
  const cipher = createCipher(Buffer.from(MASTER_KEY, "base64"));
  if (seed) await seedDemoAccounts(db, cipher);
  const setup = new SetupState(SETUP_TOKEN);
  const adapters = createAdapters(config);
  const app = await buildApp({
    config,
    db,
    adapters,
    version: "1.2.3",
    setup,
    logger: false,
    ...(onChallengeSaved ? { onChallengeSaved } : {}),
  });
  return { app, db, cipher, setup, adapters };
}

export const currentCode = (secret: string) => totpCode(secret, totpCounter(Date.now()));

/** Inserts a user directly and returns its TOTP secret (unused when `totp` is false). */
export async function createUser(t: TestApp, username: string, role: Role, { totp = true } = {}): Promise<string> {
  const secret = generateTotpSecret();
  const now = new Date().toISOString();
  await t.db
    .insertInto("users")
    .values({
      username,
      password_hash: await hashPassword(PASSWORD),
      totp_secret: totp ? t.cipher.encrypt(secret, "totp-secret") : null,
      totp_last_counter: null,
      role,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return secret;
}

export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === "ww_session");
  if (!cookie) throw new Error(`No session cookie (status ${res.statusCode}: ${res.body})`);
  return `ww_session=${cookie.value}`;
}

/** Creates a user and logs in; returns the Cookie header value. `totp: false` creates the user without 2FA. */
export async function loginAs(t: TestApp, role: Role, basePath = "", { totp = true } = {}): Promise<string> {
  const username = `${role}-user`;
  const secret = await createUser(t, username, role, { totp });
  const res = await t.app.inject({
    method: "POST",
    url: `${basePath}/api/v1/auth/login`,
    payload: { username, password: PASSWORD, ...(totp ? { code: currentCode(secret) } : {}) },
  });
  return sessionCookie(res);
}
