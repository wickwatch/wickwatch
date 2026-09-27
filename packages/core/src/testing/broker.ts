import Type from "typebox";
import { beforeEach, describe, expect, it } from "vitest";
import type { BrokerAdapter, Credentials } from "../adapters";
import {
  AccountStats,
  AlgoMetadata,
  BrokerAccount,
  Capabilities,
  Deal,
  EmergencyStopResult,
  PendingOrder,
  Position,
} from "../schemas";
import { expectAdapterError, expectSchema } from "./expect-schema";

export interface BrokerContractOptions {
  /** Returns a fresh adapter; called before every test. */
  setup: () => BrokerAdapter | Promise<BrokerAdapter>;
  credentials: Credentials;
  /** Account to test against; defaults to the first account returned. */
  account?: string;
  /** If set, `accounts()` with these credentials must fail with auth_failed. */
  invalidCredentials?: Credentials;
  /** Path to an algo for the metadata test. */
  algoPath?: string;
  /**
   * Runs tests that close positions, cancel orders and trigger the emergency stop.
   * Never enable this against a live account.
   */
  destructive?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeBrokerAdapter(name: string, options: BrokerContractOptions): void {
  describe(`BrokerAdapter contract: ${name}`, () => {
    const c = options.credentials;
    let adapter: BrokerAdapter;
    let account: string;

    beforeEach(async () => {
      adapter = await options.setup();
      account = options.account ?? (await adapter.accounts(c))[0]?.number ?? "";
    });

    it("declares its capabilities", () => {
      expect(adapter.id).toMatch(/\S/);
      expectSchema(Capabilities, adapter.capabilities());
    });

    it("lists at least one valid account", async () => {
      const accounts = await adapter.accounts(c);
      expectSchema(Type.Array(BrokerAccount), accounts);
      expect(accounts.length).toBeGreaterThan(0);
    });

    it.skipIf(!options.invalidCredentials)("rejects invalid credentials with auth_failed", async () => {
      await expectAdapterError(adapter.accounts(options.invalidCredentials!), "auth_failed");
    });

    it("lists unique symbols", async () => {
      const symbols = await adapter.symbols(c, account);
      expectSchema(Type.Array(Type.String({ minLength: 1 })), symbols);
      expect(new Set(symbols).size).toBe(symbols.length);
    });

    it("returns valid account stats", async () => {
      expectSchema(AccountStats, await adapter.stats(c, account));
    });

    it("returns valid positions and pending orders", async () => {
      expectSchema(Type.Array(Position), await adapter.positions(c, account));
      if (adapter.capabilities().pendingOrders) {
        expectSchema(Type.Array(PendingOrder), await adapter.pendingOrders(c, account));
      }
    });

    it("returns deals inside the requested range", async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 7 * DAY_MS);
      const deals = await adapter.deals(c, account, from.toISOString(), to.toISOString());
      expectSchema(Type.Array(Deal), deals);
      for (const deal of deals) {
        const time = Date.parse(deal.time);
        expect(time).toBeGreaterThanOrEqual(from.getTime());
        expect(time).toBeLessThanOrEqual(to.getTime());
      }
    });

    it.skipIf(!options.algoPath)("reads algo metadata with unique parameter names", async () => {
      const metadata = await adapter.algoMetadata(options.algoPath!);
      expectSchema(AlgoMetadata, metadata);
      const names = metadata.parameters.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    });

    describe.skipIf(!options.destructive)("destructive", () => {
      it("closes a position", async () => {
        const [position] = await adapter.positions(c, account);
        if (!position) return;
        await adapter.closePosition(c, account, position.id);
        expect((await adapter.positions(c, account)).some((p) => p.id === position.id)).toBe(false);
      });

      it("rejects closing an unknown position with not_found", async () => {
        await expectAdapterError(adapter.closePosition(c, account, "wickwatch-contract-unknown"), "not_found");
      });

      it("cancels a pending order", async () => {
        if (!adapter.capabilities().pendingOrders) return;
        const [order] = await adapter.pendingOrders(c, account);
        if (!order) return;
        await adapter.cancelOrder(c, account, order.id);
        expect((await adapter.pendingOrders(c, account)).some((o) => o.id === order.id)).toBe(false);
      });

      it("emergency stop closes all positions and cancels all orders", async () => {
        if (!adapter.capabilities().emergencyStop) return;
        const positions = await adapter.positions(c, account);
        const orders = adapter.capabilities().pendingOrders ? await adapter.pendingOrders(c, account) : [];
        const result = await adapter.emergencyStop(c, account);
        expectSchema(EmergencyStopResult, result);
        expect(result).toEqual({ closed: positions.length, cancelled: orders.length });
        expect(await adapter.positions(c, account)).toEqual([]);
      });
    });
  });
}
