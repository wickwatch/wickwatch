import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrokerAdapter } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";

/** Which reader produces an algo's metadata; stored with each algo. */
export const metadataReader = (broker: BrokerAdapter) => `${broker.id}:${String(broker.algoMetadataVersion ?? 0)}`;

/**
 * Reads the stored algos again whose metadata came from another reader: an older version of the adapter, which knew
 * less (e.g. no option values), or another adapter. Name and version stay, since configurations refer to them; the
 * parameters, build time and full-access flag are replaced. An algo that cannot be read keeps its metadata and is tried
 * again at the next start.
 */
export async function refreshAlgoMetadata(opts: {
  db: Db;
  broker: BrokerAdapter;
  algosDir: string;
  log: FastifyBaseLogger;
}): Promise<{ refreshed: number; failed: number }> {
  const { db, broker, algosDir, log } = opts;
  const reader = metadataReader(broker);
  const stale = await db
    .selectFrom("algos")
    .select(["id", "name", "version", "file_path"])
    .where((eb) => eb.or([eb("metadata_reader", "is", null), eb("metadata_reader", "!=", reader)]))
    .execute();
  let refreshed = 0;
  let failed = 0;
  for (const algo of stale) {
    const path = join(algosDir, algo.file_path);
    if (!existsSync(path)) {
      failed++;
      log.warn({ algo: `${algo.name} ${algo.version}`, path }, "Algo file missing; metadata not read again");
      continue;
    }
    try {
      const metadata = await broker.algoMetadata(path);
      await db
        .updateTable("algos")
        .set({
          metadata: JSON.stringify(metadata),
          build_time: metadata.buildTime ?? null,
          full_access: metadata.fullAccess ? 1 : 0,
          metadata_reader: reader,
        })
        .where("id", "=", algo.id)
        .execute();
      refreshed++;
    } catch (error) {
      failed++;
      log.warn({ err: error, algo: `${algo.name} ${algo.version}` }, "Algo metadata could not be read again");
    }
  }
  if (stale.length) log.info({ refreshed, failed, reader }, "Algo metadata refreshed");
  return { refreshed, failed };
}
