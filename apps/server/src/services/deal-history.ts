import type { BrokerAdapter, Deal } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { AccountEntry } from "../accounts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The detail ranges go back this far; older deals come from here. */
export const RECENT_DAYS = 90;
/** Asked in pieces the size of the longest range, which every broker adapter answers. */
const CHUNK_DAYS = 90;
/** That many empty pieces in a row count as the start of the account's history. */
const EMPTY_CHUNKS = 2;
const MAX_YEARS = 10;
const RETRY_MS = 5 * 60 * 1000;

export interface DealHistory {
  /** Start of the recent part: the current UTC day minus RECENT_DAYS. Older deals come from here. */
  cutoff(): Date;
  /** The account's deals before the cutoff if loaded; starts loading them otherwise. */
  peek(entry: AccountEntry): Deal[] | undefined;
  /** The account's deals before the cutoff; waits for them. */
  load(entry: AccountEntry): Promise<Deal[]>;
}

/**
 * Closed deals do not change, so the older history of an account is read once per UTC day, walking
 * back until a long stretch without deals (brokers do not say when an account started trading).
 */
export function createDealHistory(broker: BrokerAdapter, log: FastifyBaseLogger, now = () => Date.now()): DealHistory {
  const cache = new Map<string, { cutoff: number; deals: Promise<Deal[]>; ready?: Deal[] }>();
  const failed = new Map<string, number>();
  const cutoff = () => Math.floor(now() / DAY_MS) * DAY_MS - RECENT_DAYS * DAY_MS;

  async function read(entry: AccountEntry, end: number): Promise<Deal[]> {
    const c = await entry.credentials();
    const deals: Deal[] = [];
    const limit = end - MAX_YEARS * 365 * DAY_MS;
    let empty = 0;
    for (let to = end; to > limit && empty < EMPTY_CHUNKS; to -= CHUNK_DAYS * DAY_MS) {
      const from = to - CHUNK_DAYS * DAY_MS;
      // The broker includes both ends; each deal belongs to one piece.
      const chunk = (
        await broker.deals(c, entry.number, new Date(from).toISOString(), new Date(to).toISOString())
      ).filter((d) => Date.parse(d.time) < to);
      empty = chunk.length ? 0 : empty + 1;
      deals.push(...chunk);
    }
    return deals.sort((a, b) => a.time.localeCompare(b.time));
  }

  function get(entry: AccountEntry) {
    const end = cutoff();
    const hit = cache.get(entry.number);
    if (hit?.cutoff === end) return hit;
    const state: { cutoff: number; deals: Promise<Deal[]>; ready?: Deal[] } = {
      cutoff: end,
      deals: read(entry, end),
    };
    state.deals.then(
      (deals) => {
        state.ready = deals;
        failed.delete(entry.number);
      },
      (error: unknown) => {
        log.warn({ err: error, account: entry.number }, "Deal history unavailable");
        if (cache.get(entry.number) === state) cache.delete(entry.number);
        failed.set(entry.number, now());
      },
    );
    cache.set(entry.number, state);
    return state;
  }

  return {
    cutoff: () => new Date(cutoff()),
    peek(entry) {
      const at = failed.get(entry.number);
      if (at !== undefined && now() - at < RETRY_MS && !cache.has(entry.number)) return undefined;
      return get(entry).ready;
    },
    load: (entry) => get(entry).deals,
  };
}
