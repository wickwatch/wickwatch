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
