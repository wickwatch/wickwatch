import type { AccountSize, AccountSizeCheck } from "@wickwatch/core";
import { readProfiles } from "../challenges/store";
import type { Db } from "../db";

/**
 * The sizes of the accounts to check an algo's account size parameter against: the challenge's start balance, else the
 * balance at the start of the latest trading day the poller recorded. From the database only, never a broker call.
 */
export async function accountSizes(db: Db): Promise<Map<number, AccountSize>> {
  const [profiles, dayStarts] = await Promise.all([
    readProfiles(db),
    db
      .selectFrom("daily_stats as d")
      .select(["d.account_id", "d.start_balance"])
      .where("d.start_balance", "is not", null)
      .where("d.day", "=", (eb) =>
        eb
          .selectFrom("daily_stats as latest")
          .select((x) => x.fn.max("latest.day").as("day"))
          .whereRef("latest.account_id", "=", "d.account_id")
          .where("latest.start_balance", "is not", null),
      )
      .execute(),
  ]);
  const sizes = new Map<number, AccountSize>();
  for (const row of dayStarts) {
    if (row.start_balance !== null) sizes.set(row.account_id, { value: row.start_balance, basis: "dayStart" });
  }
  for (const [accountId, profile] of profiles) {
    sizes.set(accountId, { value: profile.startBalance, basis: "challengeStart" });
  }
  return sizes;
}

/** What to check an instance's configuration with; undefined when the algo names no parameter or the size is unknown. */
export async function accountSizeCheck(
  db: Db,
  algoName: string,
  accountId: number,
): Promise<AccountSizeCheck | undefined> {
  const [settings, sizes] = await Promise.all([
    db
      .selectFrom("algo_settings")
      .select("account_size_parameter")
      .where("algo_name", "=", algoName)
      .executeTakeFirst(),
    accountSizes(db),
  ]);
  const parameter = settings?.account_size_parameter;
  const reference = sizes.get(accountId);
  return parameter && reference ? { parameter, reference } : undefined;
}
