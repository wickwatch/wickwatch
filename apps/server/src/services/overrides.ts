import {
  overrideKey,
  positionItem,
  type AccountSnapshot,
  type AttributionOverrides,
  type Attributor,
} from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import { findAccountId, type AccountDirectory } from "../accounts";
import type { Db } from "../db";

/** Manual attributions of the active broker adapter's accounts, keyed by account number and position id. */
export async function loadOverrides(db: Db, brokerId: string): Promise<AttributionOverrides> {
  const rows = await db
    .selectFrom("attribution_overrides")
    .innerJoin("accounts", "accounts.id", "attribution_overrides.account_id")
    .select(["accounts.number", "attribution_overrides.position_id", "attribution_overrides.instance"])
    .where("accounts.adapter", "=", brokerId)
    .execute();
  return new Map(rows.map((r) => [overrideKey(r.number, r.position_id), r.instance]));
}

/** Owners remembered when positions were first seen open, keyed like the overrides. */
export async function loadRemembered(db: Db, brokerId: string): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("attribution_remembered")
    .innerJoin("accounts", "accounts.id", "attribution_remembered.account_id")
    .select(["accounts.number", "attribution_remembered.position_id", "attribution_remembered.instance"])
    .where("accounts.adapter", "=", brokerId)
    .execute();
  return new Map(rows.map((r) => [overrideKey(r.number, r.position_id), r.instance]));
}

/**
 * Remembers the owner of each open position not remembered yet, if the rules name one now (a matching label, or the
 * only instance running on the account and symbol). Positions no rule decides stay open: those can be attributed by
 * hand. Never fails: errors are logged.
 */
export async function rememberOwners(
  db: Db,
  directory: AccountDirectory,
  accounts: AccountSnapshot[],
  attributor: Attributor,
  remembered: ReadonlyMap<string, string>,
  log: FastifyBaseLogger,
  now: Date,
): Promise<void> {
  try {
    for (const account of accounts) {
      const fresh = (account.data?.positions ?? []).flatMap((p) => {
        if (remembered.has(overrideKey(account.number, p.id))) return [];
        const instance = attributor.ruleOwner(account.number, positionItem(p));
        return instance ? [{ position_id: p.id, instance }] : [];
      });
      if (!fresh.length) continue;
      const accountId = await findAccountId(directory, account.number);
      if (accountId === undefined) continue;
      await db
        .insertInto("attribution_remembered")
        .values(fresh.map((f) => ({ ...f, account_id: accountId, created_at: now.toISOString() })))
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  } catch (error) {
    log.warn({ err: error }, "Remembering trade owners failed");
  }
}
