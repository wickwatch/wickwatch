// Read-only run against the real cTrader CLI. Never enables destructive tests.
//   WICKWATCH_CTRADER_TEST=1 CTRADER_CTID=… CTRADER_PWD_FILE=… CTRADER_ACCOUNT=… [CTRADER_ALGO=…] \
//     pnpm --filter @wickwatch/adapter-ctrader-cli test
import { readFileSync } from "node:fs";
import { describeBrokerAdapter } from "@wickwatch/core/testing";
import { describe, expect, it } from "vitest";
import { CtraderCliBroker } from "../src";

const env = process.env;
const enabled = env["WICKWATCH_CTRADER_TEST"] === "1";
const credentials = enabled
  ? { login: env["CTRADER_CTID"] ?? "", secret: readFileSync(env["CTRADER_PWD_FILE"] ?? "", "utf8").trim() }
  : { login: "", secret: "" };
const account = env["CTRADER_ACCOUNT"] ?? "";
const algoPath = env["CTRADER_ALGO"];

describe.skipIf(!enabled)("CtraderCliBroker against the real CLI (read-only)", () => {
  const broker = new CtraderCliBroker();

  describeBrokerAdapter("ctrader-cli (real)", {
    setup: () => broker,
    credentials,
    account,
    ...(algoPath ? { algoPath } : {}),
    destructive: false,
  });

  it("reuses one session and answers quickly once it is warm", async () => {
    await broker.stats(credentials, account);
    const start = Date.now();
    await broker.positions(credentials, account);
    await broker.pendingOrders(credentials, account);
    expect(Date.now() - start).toBeLessThan(2000);
    await broker.dispose();
  }, 120_000);
});
