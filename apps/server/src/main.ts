import { fileURLToPath } from "node:url";
import { createAdapters } from "./adapters";
import { buildApp } from "./app";
import { deleteExpiredSessions } from "./auth/sessions";
import { needsSetup, SetupState } from "./auth/setup";
import { ConfigError, loadConfig } from "./config";
import { createDatabase, migrateToLatest } from "./db";
import { seedDemoAccounts } from "./demo-seed";
import { createCipher } from "./security/cipher";
import { VERSION } from "./version";

try {
  const config = loadConfig(process.env);
  // In the Docker image the SPA sits next to the server bundle (/app/web).
  config.webDistDir ??= fileURLToPath(new URL("../web", import.meta.url));

  const db = createDatabase(config.database);
  const adapters = createAdapters(config);
  const setup = new SetupState();
  const app = await buildApp({ config, db, adapters, version: VERSION, setup });

  for (const result of await migrateToLatest(db)) {
    app.log.info({ migration: result.migrationName, status: result.status }, "Database migration");
  }
  await deleteExpiredSessions(db);

  if (!config.masterKey) {
    app.log.warn(
      "MASTER_KEY is not set: setup, login and stored credentials are unavailable (openssl rand -base64 32)",
    );
  } else if (adapters.broker.id === "demo" && (await seedDemoAccounts(db, createCipher(config.masterKey)))) {
    app.log.info("Demo accounts added");
  }

  if (await needsSetup(db)) {
    // One-time bootstrap secret for the first admin; not a broker credential. Invalid after setup.
    app.log.warn(`No admin yet. Open ${config.basePath}/setup and enter the setup token: ${setup.ensureToken()}`);
  }

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
