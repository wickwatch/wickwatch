import {
  AdapterError,
  type AccountStats,
  type AlgoMetadata,
  type BrokerAccount,
  type BrokerAdapter,
  type Capabilities,
  type Credentials,
  type Deal,
  type EmergencyStopResult,
  type IsoTime,
  type PendingOrder,
  type Position,
} from "@wickwatch/core";
import { cliError, DEFAULT_CLI_OPTIONS, extractJson, runBatch, SecretFile, type CliOptions } from "./cli";
import {
  toAccountStats,
  toAlgoMetadata,
  toBrokerAccounts,
  toDeals,
  toPendingOrders,
  toPositions,
  toSymbols,
} from "./mapping";
import { SessionPool } from "./session";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCOUNTS_CACHE_MS = 60_000;

const dateOnly = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Broker adapter for the cTrader CLI (tested with 5.9). Read-only for now: closing positions,
 * cancelling orders and the emergency stop answer `unsupported` until they are verified on a demo account.
 */
/** Output of `ctrader-cli periods` (5.9), time-based frames first; tokens are case-insensitive. */
const PERIODS = [
  ..."m1 m2 m3 m4 m5 m6 m7 m8 m9 m10 m15 m20 m30 m45 h1 h2 h3 h4 h6 h8 h12 D1 D2 D3 W1 Month1".split(" "),
  ..."t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t15 t20 t25 t30 t40 t50 t60 t80 t90 t100 t150 t200 t250 t300 t500 t750 t1000".split(
    " ",
  ),
  ..."Re1 Re2 Re3 Re4 Re5 Re6 Re7 Re8 Re9 Re10 Re15 Re20 Re25 Re30 Re35 Re40 Re45 Re50 Re100 Re150 Re200 Re300 Re500 Re800 Re1000 Re2000".split(
    " ",
  ),
  ..."Ra1 Ra2 Ra3 Ra4 Ra5 Ra8 Ra10 Ra20 Ra30 Ra50 Ra80 Ra100 Ra150 Ra200 Ra300 Ra500 Ra800 Ra1000 Ra2000 Ra5000 Ra7500 Ra10000".split(
    " ",
  ),
  ..."Hm1 Hm2 Hm3 Hm4 Hm5 Hm6 Hm7 Hm8 Hm9 Hm10 Hm15 Hm20 Hm30 Hm45 Hh1 Hh2 Hh3 Hh4 Hh6 Hh8 Hh12 Hd1 Hd2 Hd3 Hw1 HMonth1".split(
    " ",
  ),
];

export class CtraderCliBroker implements BrokerAdapter {
  readonly id = "ctrader-cli";
  private readonly options: CliOptions;
  private readonly pool: SessionPool;
  private accountsCache: { key: string; at: number; accounts: BrokerAccount[] } | undefined;

  constructor(options: Partial<CliOptions> = {}) {
    this.options = { ...DEFAULT_CLI_OPTIONS, ...options };
    this.pool = new SessionPool(this.options);
  }

  capabilities(): Capabilities {
    return {
      backtest: false,
      optimize: false,
      partialClose: false,
      pendingOrders: true,
      emergencyStop: false,
      parameterExport: [],
    };
  }

  periods(): string[] {
    return PERIODS;
  }

  /** All linked accounts; `active` is false for closed ones (they fail with a misleading message). */
  async accounts(c: Credentials): Promise<BrokerAccount[]> {
    const key = `${c.login}\u0000${c.secret}`;
    if (this.accountsCache?.key === key && Date.now() - this.accountsCache.at < ACCOUNTS_CACHE_MS) {
      return this.accountsCache.accounts;
    }
    const batch = extractJson(await this.batch(c, ["accounts"]));
    const numbers = Array.isArray(batch) ? batch.map((a: { Number?: unknown }) => String(a.Number)) : [];
    // The shell lists only active accounts, but needs one to log in to: try them in order.
    let active: unknown;
    for (const number of numbers) {
      try {
        active = extractJson(await this.pool.run(c, number, "accounts"));
        break;
      } catch (error) {
        if (error instanceof AdapterError && error.code === "auth_failed") throw error;
      }
    }
    const accounts = toBrokerAccounts(batch, active);
    this.accountsCache = { key, at: Date.now(), accounts };
    return accounts;
  }

  async symbols(c: Credentials, account: string): Promise<string[]> {
    return toSymbols(extractJson(await this.batch(c, ["symbols", `--account=${account}`])));
  }

  async stats(c: Credentials, account: string): Promise<AccountStats> {
    return toAccountStats(extractJson(await this.pool.run(c, account, `account ${account}`)), new Date());
  }

  async positions(c: Credentials, account: string): Promise<Position[]> {
    return toPositions(extractJson(await this.pool.run(c, account, "positions")));
  }

  async pendingOrders(c: Credentials, account: string): Promise<PendingOrder[]> {
    return toPendingOrders(extractJson(await this.pool.run(c, account, "orders")));
  }

  /** `deals <from> <to>` takes whole UTC days and excludes the end day, so ask one day more and filter. */
  async deals(c: Credentials, account: string, from: IsoTime, to: IsoTime): Promise<Deal[]> {
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start)
      throw new AdapterError("invalid_input", "Invalid deal range");
    const answer = await this.pool.run(c, account, `deals ${dateOnly(start)} ${dateOnly(end + DAY_MS)}`);
    return toDeals(extractJson(answer))
      .filter((d) => {
        const t = Date.parse(d.time);
        return t >= start && t <= end;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  closePosition(): Promise<void> {
    return Promise.reject(new AdapterError("unsupported", "Closing positions via the cTrader CLI is not enabled yet"));
  }

  cancelOrder(): Promise<void> {
    return Promise.reject(new AdapterError("unsupported", "Cancelling orders via the cTrader CLI is not enabled yet"));
  }

  emergencyStop(): Promise<EmergencyStopResult> {
    return Promise.reject(new AdapterError("unsupported", "The emergency stop via the cTrader CLI is not enabled yet"));
  }

  async algoMetadata(algoPath: string): Promise<AlgoMetadata> {
    const { code, output } = await runBatch(this.options, ["metadata", algoPath]);
    if (code !== 0) throw cliError(output, `Cannot read metadata of ${algoPath}`);
    return toAlgoMetadata(extractJson(output));
  }

  async dispose(): Promise<void> {
    await this.pool.closeAll();
  }

  /** Batch commands authenticate with a temporary password file. */
  private async batch(c: Credentials, args: string[]): Promise<string> {
    const secret = await SecretFile.create(c.secret);
    try {
      const { code, output } = await runBatch(this.options, [
        ...args,
        `--ctid=${c.login}`,
        `--pwd-file=${secret.path}`,
      ]);
      if (code !== 0) throw cliError(output);
      return output;
    } finally {
      await secret.remove();
    }
  }
}
