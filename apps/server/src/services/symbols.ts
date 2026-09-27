import type { BrokerAdapter } from "@wickwatch/core";
import type { AccountEntry } from "../accounts";

const TTL_MS = 60 * 60 * 1000;

export interface SymbolCache {
  /** Symbols the broker offers on the account; cached, since listing them is slow for some brokers. */
  get(entry: AccountEntry): Promise<string[]>;
}

export function createSymbolCache(broker: BrokerAdapter, now = () => Date.now()): SymbolCache {
  const cache = new Map<string, { at: number; symbols: Promise<string[]> }>();
  return {
    get(entry) {
      const hit = cache.get(entry.number);
      if (hit && now() - hit.at < TTL_MS) return hit.symbols;
      const symbols = entry.credentials().then((c) => broker.symbols(c, entry.number));
      cache.set(entry.number, { at: now(), symbols });
      // Failures are not cached.
      symbols.catch(() => cache.delete(entry.number));
      return symbols;
    },
  };
}
