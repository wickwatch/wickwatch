import { overrideKey, type AttributionOverrides } from "@wickwatch/core";
import type { Db } from "../db";

/** All manual attributions, keyed by account number and position id. */
export async function loadOverrides(db: Db): Promise<AttributionOverrides> {
  const rows = await db
    .selectFrom("attribution_overrides")
    .innerJoin("accounts", "accounts.id", "attribution_overrides.account_id")
    .select(["accounts.number", "attribution_overrides.position_id", "attribution_overrides.instance"])
    .execute();
  return new Map(rows.map((r) => [overrideKey(r.number, r.position_id), r.instance]));
}
