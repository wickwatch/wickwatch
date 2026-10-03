import {
  lossLimitAmounts,
  type AccountSize,
  type AlgoSettings,
  type AccountSizeCheck,
  type LossLimits,
  type RiskCheck,
} from "@wickwatch/core";
import { parameterChecks as checksOf } from "@wickwatch/core/parameters";
import { readProfiles } from "../challenges/store";
import type { Db } from "../db";

/** An algo's settings as the API gives them, from its row. */
export const algoSettingsOf = (row: {
  algo_name: string;
  account_size_parameter: string | null;
  risk_parameter: string | null;
}): AlgoSettings => ({
  algoName: row.algo_name,
  ...(row.account_size_parameter ? { accountSizeParameter: row.account_size_parameter } : {}),
  ...(row.risk_parameter ? { riskParameter: row.risk_parameter } : {}),
});

/**
 * The sizes of the accounts to check an algo's account size parameter against, and the loss limits of their
 * challenges in money (for the risk preview). Sizes: the challenge's start balance, else the balance at the start of
 * the latest trading day the poller recorded. From the database only, never a broker call.
 */
export async function accountReferences(
  db: Db,
): Promise<{ sizes: Map<number, AccountSize>; limits: Map<number, LossLimits> }> {
  const [profiles, rows] = await Promise.all([
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
  const dayStarts = new Map<number, number>();
  for (const row of rows) if (row.start_balance !== null) dayStarts.set(row.account_id, row.start_balance);
  const sizes = new Map<number, AccountSize>();
  const limits = new Map<number, LossLimits>();
  for (const [accountId, value] of dayStarts) sizes.set(accountId, { value, basis: "dayStart" });
  for (const [accountId, profile] of profiles) {
    sizes.set(accountId, { value: profile.startBalance, basis: "challengeStart" });
    const found = lossLimitAmounts(profile, dayStarts.get(accountId));
    if (found) limits.set(accountId, found);
  }
  return { sizes, limits };
}

/** The account size check and the risk check of an instance's configuration; each missing when it does not apply. */
export async function parameterChecks(
  db: Db,
  algoName: string,
  accountId: number,
): Promise<{ accountSizeCheck?: AccountSizeCheck; riskCheck?: RiskCheck }> {
  const [settings, account, { sizes, limits }] = await Promise.all([
    db
      .selectFrom("algo_settings")
      .select(["algo_name", "account_size_parameter", "risk_parameter"])
      .where("algo_name", "=", algoName)
      .executeTakeFirst(),
    db.selectFrom("accounts").select("currency").where("id", "=", accountId).executeTakeFirst(),
    accountReferences(db),
  ]);
  const accountSize = sizes.get(accountId);
  const lossLimits = limits.get(accountId);
  return checksOf(
    settings && algoSettingsOf(settings),
    account && {
      currency: account.currency,
      ...(accountSize ? { accountSize } : {}),
      ...(lossLimits ? { lossLimits } : {}),
    },
  );
}
