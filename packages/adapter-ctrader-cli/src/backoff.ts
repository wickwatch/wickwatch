import { createHash } from "node:crypto";
import { AdapterError, type Credentials } from "@wickwatch/core";

const key = (credentials: Credentials, scope: string[]): string =>
  createHash("sha256")
    .update([credentials.login, credentials.secret, ...scope].join("\u0000"))
    .digest("hex");

/**
 * Waits after a failed login before the next one, doubling up to a maximum, so a wrong password or a
 * broker outage does not log in again on every poll (brokers and prop firms watch logins). Until then
 * the login fails at once with its last error; a successful one clears it. A rejected password holds
 * every login of that cTrader ID, other failures only the same login (account, batch command). A changed
 * password is a new login.
 */
export class LoginBackoff {
  private readonly failed = new Map<string, { count: number; until: number; error: unknown }>();

  constructor(
    private readonly firstMs: number,
    private readonly maxMs: number,
  ) {}

  /** `urgent` logs in even while waiting: trading actions such as the emergency stop must not be held back. */
  async login<T>(credentials: Credentials, scope: string[], attempt: () => Promise<T>, urgent = false): Promise<T> {
    const whole = key(credentials, []);
    const own = key(credentials, scope);
    const now = Date.now();
    const held = [whole, own].map((k) => this.failed.get(k)).find((f) => f && now < f.until);
    if (held && !urgent) throw held.error;
    try {
      const result = await attempt();
      this.failed.delete(whole);
      this.failed.delete(own);
      return result;
    } catch (error) {
      this.fail(error instanceof AdapterError && error.code === "auth_failed" ? whole : own, error);
      throw error;
    }
  }

  private fail(k: string, error: unknown): void {
    const now = Date.now();
    // Logins that were given up (old password, removed account) are not kept forever.
    for (const [other, f] of this.failed) if (now > f.until + this.maxMs) this.failed.delete(other);
    const count = (this.failed.get(k)?.count ?? 0) + 1;
    this.failed.set(k, { count, until: now + Math.min(this.firstMs * 2 ** (count - 1), this.maxMs), error });
  }
}
