import { overrideKey, type AttributionOverrides } from "@wickwatch/core";
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
