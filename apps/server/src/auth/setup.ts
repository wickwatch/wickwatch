import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../db";

/**
 * First-run state: while no user exists, a one-time token (printed to the server log)
 * is needed to create the admin, so nobody else can claim a fresh instance.
 */
export class SetupState {
  private token: string | undefined;
  /** TOTP secret shown to the user, waiting for the first valid code. */
  pendingTotpSecret: string | undefined;

  constructor(token?: string) {
    this.token = token;
  }

  ensureToken(): string {
    return (this.token ??= randomBytes(18).toString("base64url"));
  }

  matches(candidate: string): boolean {
    if (!this.token) return false;
    const a = Buffer.from(this.token);
    const b = Buffer.from(candidate);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  complete(): void {
    this.token = undefined;
    this.pendingTotpSecret = undefined;
  }
}

export async function needsSetup(db: Db): Promise<boolean> {
  return !(await db.selectFrom("users").select("id").limit(1).executeTakeFirst());
}
