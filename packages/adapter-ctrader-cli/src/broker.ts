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
  type Id,
  type IsoTime,
  type Launch,
  type LaunchInput,
  type LogEvent,
  type PendingOrder,
  type Position,
} from "@wickwatch/core";
import { basename } from "node:path";
import { CbotsetConfigAdapter } from "@wickwatch/adapter-cbotset";
import { cliError, DEFAULT_CLI_OPTIONS, extractJson, passwordFile, runBatch, type CliOptions } from "./cli";
import {
  toAccountStats,
  toAlgoMetadata,
  toBrokerAccounts,
  toDeals,
  toInitialStops,
  checkParameterNames,
  redactStartupTable,
  toLogEvent,
  positionsWithoutPrices,
  toPendingOrders,
  toPositions,
  toSymbols,
} from "./mapping";
import { SessionPool } from "./session";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Positions closed in a range may have been opened before it; their opening orders are looked up this far back. */
const STOP_LOOKBACK_MS = 14 * DAY_MS;
/** Listings of positions without prices before giving up (see positionsWithoutPrices). */
const PRICE_ATTEMPTS = 6;

/** Official image of the CLI; pinned, the version the adapter was tested with. */
export const DEFAULT_CTRADER_IMAGE = "ghcr.io/spotware/ctrader-console:5.9.11";
/** Where Wickwatch puts the algo and the password file inside an instance. */
const MOUNT = "/mnt/wickwatch";

export interface CtraderCliBrokerOptions extends Partial<CliOptions> {
  /** Image instances run with, e.g. ghcr.io/spotware/ctrader-console:5.9.11. */
  image?: string;
}
const ACCOUNTS_CACHE_MS = 60_000;

const dateOnly = (time: number) => new Date(time).toISOString().slice(0, 10);

/**
 * Broker adapter for the cTrader CLI (tested with 5.9): accounts, balances, positions, orders and
 * deals, closing positions, cancelling orders and the emergency stop per account.
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

  private readonly image: string;

  constructor({ image, ...options }: CtraderCliBrokerOptions = {}) {
    this.image = image ?? DEFAULT_CTRADER_IMAGE;
    this.options = { ...DEFAULT_CLI_OPTIONS, ...options };
    this.pool = new SessionPool(this.options);
  }

  capabilities(): Capabilities {
    return {
      backtest: false,
      optimize: false,
      partialClose: false,
      pendingOrders: true,
      emergencyStop: true,
      parameterExport: [],
    };
  }

  periods(): string[] {
    return PERIODS;
  }

  logEvent(text: string): LogEvent | undefined {
    return toLogEvent(text);
  }

  redactLog(text: string): string {
    return redactStartupTable(text);
  }

  /**
   * `run` in the official image. Password and parameters are files copied into the instance, never
   * arguments, so `docker inspect` shows neither (parameter sets may hold licence keys);
   * `--exit-on-stop` ends the container when the cBot stops, so its state is visible and restarts work.
   */
  async launch(input: LaunchInput): Promise<Launch> {
    const algoFile = `${MOUNT}/${input.algo.name.replace(/[^A-Za-z0-9._-]/g, "-")}.algo`;
    const pwdFile = `${MOUNT}/ctid.pwd`;
    const parametersFile = `${MOUNT}/parameters.cbotset`;
    checkParameterNames(input.parameters);
    return {
      image: this.image,
      command: [
        "run",
        algoFile,
        parametersFile,
        `--ctid=${input.credentials.login}`,
        `--pwd-file=${pwdFile}`,
        `--account=${input.account}`,
        `--symbol=${input.symbol}`,
        `--period=${input.period}`,
        "--exit-on-stop",
        ...(input.algo.fullAccess ? ["--full-access"] : []),
      ],
      files: [
        { path: algoFile, content: input.algo.file, mode: 0o444 },
        { path: pwdFile, content: new TextEncoder().encode(input.credentials.secret), mode: 0o400 },
        {
          path: parametersFile,
          content: new CbotsetConfigAdapter().serialize(input.parameters, input.algo.parameters, {
            symbol: input.symbol,
            period: input.period,
          }),
          mode: 0o400,
        },
      ],
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

  /** Asks again for a moment when the session has no prices for the positions yet. */
  async positions(c: Credentials, account: string): Promise<Position[]> {
    for (let attempt = 1; ; attempt++) {
      const data = extractJson(await this.pool.run(c, account, "positions"));
      if (!positionsWithoutPrices(data)) return toPositions(data);
      if (attempt >= PRICE_ATTEMPTS) {
        throw new AdapterError("unavailable", "The broker has not sent prices for the open positions yet");
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.priceRetryMs));
    }
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
    const deals = toDeals(extractJson(answer))
      .filter((d) => {
        const t = Date.parse(d.time);
        return t >= start && t <= end;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
    const stops = await this.initialStops(c, account, start - STOP_LOOKBACK_MS, end + DAY_MS);
    return deals.map((d) => {
      const stop = stops.get(d.positionId);
      return stop === undefined ? d : { ...d, initialStopLoss: stop };
    });
  }

  /** Stops the positions were opened with; without them the deals still count, only their risk and R are unknown. */
  private async initialStops(c: Credentials, account: string, from: number, to: number) {
    try {
      const answer = await this.pool.run(c, account, `orders-history ${dateOnly(from)} ${dateOnly(to)}`);
      return toInitialStops(extractJson(answer));
    } catch {
      return new Map<string, number>();
    }
  }

  // What the CLI answers to these commands is not documented, so each one counts only when the
  // position or order is gone from a fresh listing afterwards.

  /** `position close <id> yes` in the account's shell session. */
  async closePosition(c: Credentials, account: string, positionId: Id): Promise<void> {
    await this.pool.run(c, account, `position close ${shellId(positionId)} yes`);
    if ((await this.positions(c, account)).some((p) => p.id === positionId)) {
      throw new AdapterError("unavailable", `Position ${positionId} is still open`);
    }
  }

  /** `order cancel <id> yes` in the account's shell session. */
  async cancelOrder(c: Credentials, account: string, orderId: Id): Promise<void> {
    await this.pool.run(c, account, `order cancel ${shellId(orderId)} yes`);
    if ((await this.pendingOrders(c, account)).some((o) => o.id === orderId)) {
      throw new AdapterError("unavailable", `Order ${orderId} is still pending`);
    }
  }

  /**
   * Cancels every pending order of the account first, so none fills while the positions are
   * closed, then closes every position. Stopping the instances is done by the core before.
   */
  async emergencyStop(c: Credentials, account: string): Promise<EmergencyStopResult> {
    const orders = await this.pendingOrders(c, account);
    if (orders.length) await this.pool.run(c, account, "order cancel all yes");
    const positions = await this.positions(c, account);
    if (positions.length) await this.pool.run(c, account, "position close all yes");
    const [openPositions, pendingOrders] = [await this.positions(c, account), await this.pendingOrders(c, account)];
    if (openPositions.length || pendingOrders.length) {
      throw new AdapterError(
        "unavailable",
        `Still open after the emergency stop: ${String(openPositions.length)} positions, ${String(pendingOrders.length)} orders`,
      );
    }
    return { closed: positions.length, cancelled: orders.length };
  }

  /** 1: parameter groups, colours as #AARRGGBB, enum option values. Bump with every change to toAlgoMetadata. */
  readonly algoMetadataVersion = 1;

  async algoMetadata(algoPath: string): Promise<AlgoMetadata> {
    // The CLI takes the algo's name from the file name, so the file keeps it.
    const name = basename(algoPath);
    const { code, output } = await runBatch(this.options, (path) => ["metadata", path(name)], [
      { name, path: algoPath, mode: 0o444 },
    ]);
    if (code !== 0) throw cliError(output, `Cannot read metadata of ${algoPath}`);
    return toAlgoMetadata(extractJson(output));
  }

  async dispose(): Promise<void> {
    await this.pool.closeAll();
  }

  /** Batch commands authenticate with a temporary password file. */
  private async batch(c: Credentials, args: string[]): Promise<string> {
    const { code, output } = await runBatch(
      this.options,
      (path) => [...args, `--ctid=${c.login}`, `--pwd-file=${path("pwd")}`],
      [passwordFile(c.secret)],
    );
    if (code !== 0) throw cliError(output);
    return output;
  }
}

/** Position and order ids go into a shell command line: digits only; anything else cannot exist. */
function shellId(id: Id): string {
  if (!/^\d{1,20}$/.test(id)) throw new AdapterError("not_found", `No position or order ${id}`);
  return id;
}
