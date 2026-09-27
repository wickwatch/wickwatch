import { fileURLToPath } from "node:url";
import { createAdapters } from "./adapters";
import { buildApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { createDatabase, migrateToLatest } from "./db";
import { VERSION } from "./version";

try {
  const config = loadConfig(process.env);
  // In the Docker image the SPA sits next to the server bundle (/app/web).
  config.webDistDir ??= fileURLToPath(new URL("../web", import.meta.url));

  const db = createDatabase(config.database);
  const app = await buildApp({ config, db, adapters: createAdapters(config), version: VERSION });

  for (const result of await migrateToLatest(db)) {
    app.log.info({ migration: result.migrationName, status: result.status }, "Database migration");
  }
  if (!config.masterKey) app.log.warn("MASTER_KEY is not set; storing broker credentials will be refused");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, "Shutting down");
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
