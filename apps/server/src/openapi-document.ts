import pkg from "../package.json" with { type: "json" };
import { createAdapters } from "./adapters";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDatabase } from "./db";

/** The OpenAPI document as committed in docs/openapi.json (default config, package version). */
export async function renderOpenApi(): Promise<string> {
  const config = loadConfig({ DATABASE_URL: "file::memory:" });
  const app = await buildApp({
    config,
    db: createDatabase(config.database),
    adapters: createAdapters(config),
    version: pkg.version,
    logger: false,
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
