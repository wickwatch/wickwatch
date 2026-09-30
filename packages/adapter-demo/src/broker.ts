import {
  AdapterError,
  toIsoTime,
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
  type PendingOrder,
  type Position,
} from "@wickwatch/core";
import { numericId, random, round } from "./random";
import { DEMO_IMAGE, demoCommand, type DemoWorld } from "./world";
import { ACCOUNTS, ALGOS, algoPath, INSTANCES, SYMBOLS, type DemoAccount } from "./world-data";

/** Credentials with this secret are rejected, to exercise the login-failure path. */
export const DEMO_INVALID_SECRET = "invalid";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_DEAL_RANGE_MS = 400 * DAY_MS;
const HISTORY_DAYS = 30;
const LEVERAGE = 100;

export class DemoBrokerAdapter implements BrokerAdapter {
  readonly id = "demo";

  constructor(private readonly world: DemoWorld) {}

  capabilities(): Capabilities {
    return {
      backtest: false,
      optimize: false,
      partialClose: false,
      pendingOrders: true,
      emergencyStop: true,
      parameterExport: ["json"],
    };
  }

  async accounts(c: Credentials): Promise<BrokerAccount[]> {
    authenticate(c);
    return ACCOUNTS.map(({ number, broker, currency, live }) => ({ number, broker, currency, live }));
  }

  /** Demo instances run nowhere; the command only carries what the demo runtime shows. */
  async launch(input: LaunchInput): Promise<Launch> {
    authenticate(input.credentials);
    this.world.account(input.account);
    const version = ALGOS[input.algo.name]?.version ?? "0";
    return {
      image: DEMO_IMAGE,
      command: demoCommand(algoPath(input.algo.name, version), input.account, input.symbol, input.period),
      files: [],
    };
  }

  periods(): string[] {
    return ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
  }

  async symbols(c: Credentials, account: string): Promise<string[]> {
    authenticate(c);
    this.world.account(account);
    return Object.keys(SYMBOLS);
  }

  async stats(c: Credentials, account: string): Promise<AccountStats> {
    authenticate(c);
    const acc = this.world.account(account);
    const now = this.world.now();
    const historyStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS - HISTORY_DAYS * DAY_MS;
    const realised = this.generateDeals(acc, historyStart, now.getTime()).reduce(
      (sum, d) => sum + d.pnl + (d.commission ?? 0) + (d.swap ?? 0),
      0,
    );
    const positions = this.openPositions(acc.number);
    const balance = round(acc.startBalance + realised, 2);
    const equity = round(balance + positions.reduce((sum, p) => sum + p.pnl, 0), 2);
    const margin = round(
      positions.reduce((sum, p) => sum + (p.volume * p.entry * this.world.symbol(p.symbol).contractSize) / LEVERAGE, 0),
      2,
    );
    return { balance, equity, margin, freeMargin: round(equity - margin, 2), time: toIsoTime(now) };
  }

  async positions(c: Credentials, account: string): Promise<Position[]> {
    authenticate(c);
    return this.openPositions(this.world.account(account).number);
  }

  async pendingOrders(c: Credentials, account: string): Promise<PendingOrder[]> {
    authenticate(c);
    return this.openOrders(this.world.account(account).number);
  }

  async deals(c: Credentials, account: string, from: IsoTime, to: IsoTime): Promise<Deal[]> {
    authenticate(c);
    const acc = this.world.account(account);
    const start = Date.parse(from);
    const end = Math.min(Date.parse(to), this.world.now().getTime());
    if (Number.isNaN(start) || Number.isNaN(end) || end - start > MAX_DEAL_RANGE_MS) {
      throw new AdapterError("invalid_input", "Invalid or too large deal range");
    }
    return this.generateDeals(acc, start, end);
  }

  async closePosition(c: Credentials, account: string, positionId: Id): Promise<void> {
    authenticate(c);
    if (!this.openPositions(this.world.account(account).number).some((p) => p.id === positionId)) {
      throw new AdapterError("not_found", `Unknown demo position ${positionId}`);
    }
    this.world.closedPositions.add(positionId);
  }

  async cancelOrder(c: Credentials, account: string, orderId: Id): Promise<void> {
    authenticate(c);
    if (!this.openOrders(this.world.account(account).number).some((o) => o.id === orderId)) {
      throw new AdapterError("not_found", `Unknown demo order ${orderId}`);
    }
    this.world.cancelledOrders.add(orderId);
  }

  async emergencyStop(c: Credentials, account: string): Promise<EmergencyStopResult> {
    authenticate(c);
    const number = this.world.account(account).number;
    const positions = this.openPositions(number);
    const orders = this.openOrders(number);
    for (const p of positions) this.world.closedPositions.add(p.id);
    for (const o of orders) this.world.cancelledOrders.add(o.id);
    return { closed: positions.length, cancelled: orders.length };
  }

  /** 1: a label with a description. Bump when the demo algos' parameters change. */
  readonly algoMetadataVersion = 1;

  /** Knows the demo algos by file name (`alpha.algo`, `beta.algo`) in any folder, e.g. after an upload. */
  async algoMetadata(algoPath: string): Promise<AlgoMetadata> {
    const [, name] = /(?:^|\/)([^/]+)\.algo$/.exec(algoPath) ?? [];
    const algo = name ? ALGOS[name] : undefined;
    if (!name || !algo) throw new AdapterError("not_found", `Unknown demo algo ${algoPath}`);
    // Only the stored layout …/<name>/<version>/<name>.algo carries a version.
    const version = new RegExp(`(?:^|/)${name}/([^/]+)/${name}\\.algo$`).exec(algoPath)?.[1];
    return {
      name,
      version: version ?? algo.version,
      fullAccess: false,
      parameters: structuredClone(algo.parameters),
    };
  }

  private openPositions(account: string): Position[] {
    const now = this.world.now();
    return INSTANCES.filter((i) => i.account === account).flatMap((instance) =>
      instance.positions.flatMap((seed, index): Position[] => {
        const id = numericId(this.world.seed, instance.name, "position", index);
        if (this.world.closedPositions.has(id)) return [];
        const openedAt = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - seed.hoursAgo * HOUR_MS);
        const entry = this.world.price(instance.symbol, openedAt);
        const direction = seed.side === "buy" ? 1 : -1;
        const { contractSize } = this.world.symbol(instance.symbol);
        const pnl = (this.world.price(instance.symbol, now) - entry) * direction * instance.volume * contractSize;
        return [
          {
            id,
            symbol: instance.symbol,
            side: seed.side,
            volume: instance.volume,
            entry,
            sl: round(entry - direction * seed.slDistance, 2),
            tp: round(entry + direction * seed.tpDistance, 2),
            pnl: round(pnl, 2),
            label: instance.name,
            openedAt: toIsoTime(openedAt),
          },
        ];
      }),
    );
  }

  private openOrders(account: string): PendingOrder[] {
    const now = this.world.now();
    return INSTANCES.filter((i) => i.account === account).flatMap((instance) =>
      instance.orders.flatMap((seed, index): PendingOrder[] => {
        const id = numericId(this.world.seed, instance.name, "order", index);
        if (this.world.cancelledOrders.has(id)) return [];
        const direction = seed.side === "buy" ? -1 : 1;
        return [
          {
            id,
            symbol: instance.symbol,
            type: seed.type,
            side: seed.side,
            volume: instance.volume,
            price: round(this.world.price(instance.symbol, now) + direction * seed.distance, 2),
            label: instance.name,
            ...(seed.expiresInHours === undefined
              ? {}
              : {
                  expiresAt: toIsoTime(new Date((Math.floor(now.getTime() / HOUR_MS) + seed.expiresInHours) * HOUR_MS)),
                }),
          },
        ];
      }),
    );
  }

  /** One closing deal per trade; roughly one trade per instance every 16 hours. */
  private generateDeals(account: DemoAccount, from: number, to: number): Deal[] {
    const seed = this.world.seed;
    const deals: Deal[] = [];
    const instances = INSTANCES.filter((i) => i.account === account.number);
    const opened = Math.floor(this.world.now().getTime() / DAY_MS) * DAY_MS - account.openedDaysAgo * DAY_MS;
    const start = Math.max(from, opened);
    for (let slot = Math.floor(start / HOUR_MS); slot * HOUR_MS <= to; slot++) {
      for (const instance of instances) {
        if (random(seed, instance.name, "deal", slot) >= 0.06) continue;
        const time = slot * HOUR_MS + Math.floor(random(seed, instance.name, "time", slot) * HOUR_MS);
        if (time < start || time > to) continue;
        const pnl = round((random(seed, instance.name, "pnl", slot) - 0.42) * account.startBalance * 0.006, 2);
        const side = random(seed, instance.name, "side", slot) < 0.5 ? "buy" : "sell";
        const price = this.world.price(instance.symbol, new Date(time));
        // Entry and initial stop that fit the result: 0.25 % of the start balance at risk, so R runs from -1 to +1.4.
        const perUnit = instance.volume * this.world.symbol(instance.symbol).contractSize;
        const direction = side === "buy" ? 1 : -1;
        const entryPrice = round(price - (pnl / perUnit) * direction, 2);
        const initialStopLoss = round(entryPrice - ((account.startBalance * 0.0025) / perUnit) * direction, 2);
        deals.push({
          id: numericId(seed, instance.name, "deal", slot),
          positionId: numericId(seed, instance.name, "closed-position", slot),
          symbol: instance.symbol,
          side,
          volume: instance.volume,
          price,
          pnl,
          commission: round(-3 * instance.volume, 2),
          swap: 0,
          label: instance.name,
          time: toIsoTime(new Date(time)),
          entryPrice,
          initialStopLoss,
          // Held 1 to 20 hours, so some trades run over a day change.
          openedAt: toIsoTime(
            new Date(time - Math.floor((1 + random(seed, instance.name, "hold", slot) * 19) * HOUR_MS)),
          ),
        });
      }
    }
    return deals.sort((a, b) => a.time.localeCompare(b.time));
  }
}

function authenticate(c: Credentials): void {
  if (!c.login || c.secret === DEMO_INVALID_SECRET) {
    throw new AdapterError("auth_failed", "Demo login rejected");
  }
}
