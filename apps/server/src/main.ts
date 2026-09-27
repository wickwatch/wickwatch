import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dbAccountDirectory } from "./accounts";
import { createAdapters } from "./adapters";
import { buildApp } from "./app";
import { deleteExpiredSessions } from "./auth/sessions";
import { needsSetup, SetupState } from "./auth/setup";
import { ConfigError, loadConfig } from "./config";
import { createDatabase, migrateToLatest } from "./db";
import { seedDemoAccounts, seedDemoChallenges } from "./demo-seed";
import { createCipher } from "./security/cipher";
import { AccountPoller } from "./services/poller";
import { VERSION } from "./version";

try {
  const config = loadConfig(process.env);
  // Docker image: /app/web next to the bundle. Repo checkout (`pnpm start`): apps/web/dist.
  const webDistDir =
    config.webDistDir ??
    [new URL("../web", import.meta.url), new URL("../../web/dist", import.meta.url)]
      .map((url) => fileURLToPath(url))
      .find((dir) => existsSync(dir));
  if (webDistDir) config.webDistDir = webDistDir;

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
  } else if (adapters.broker.id === "demo") {
    if (await seedDemoAccounts(db, createCipher(config.masterKey))) app.log.info("Demo accounts added");
    if (await seedDemoChallenges(db)) app.log.info("Demo challenge profiles added");
  }

  const cipher = config.masterKey ? createCipher(config.masterKey) : undefined;
  const poller = new AccountPoller({
    db,
    adapters,
    accounts: dbAccountDirectory(db, cipher, adapters.broker.id),
    log: app.log,
    statsIntervalMs: config.accountPollSeconds * 1000,
  });
  app.addHook("onClose", () => {
    poller.stop();
  });

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
  poller.start();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
