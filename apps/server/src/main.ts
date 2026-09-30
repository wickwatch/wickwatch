import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dbAccountDirectory } from "./accounts";
import { createAdapters } from "./adapters";
import { buildApp } from "./app";
import { deleteExpiredSessions } from "./auth/sessions";
import { needsSetup, SetupState } from "./auth/setup";
import { loadConfig } from "./config";
import { ConfigError } from "./config-error";
import { createDatabase, migrateToLatest } from "./db";
import { seedDemoAccounts, seedDemoChallenges } from "./demo-seed";
import { createCipher } from "./security/cipher";
import { refreshAlgoMetadata } from "./services/algo-metadata";
import { encryptStoredParameters } from "./services/instance-configs";
import { InstanceKeeper } from "./services/instance-keeper";
import { LossGuardService } from "./services/loss-guard";
import { Maintenance } from "./services/maintenance";
import { AlertNotifier } from "./services/notifier";
import { ClockCheck } from "./services/clock-check";
import { DailySummary } from "./services/daily-summary";
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
  const cipher = config.masterKey ? createCipher(config.masterKey) : undefined;
  const accounts = dbAccountDirectory(db, cipher, adapters.broker.id);
  // The poller is created below (it needs the app's logger); a profile saved before that is marked by its first run.
  const tradingDays: { sync?: (accountId: number) => Promise<void> } = {};
  const app = await buildApp({
    config,
    db,
    adapters,
    version: VERSION,
    setup,
    onChallengeSaved: (accountId) => void tradingDays.sync?.(accountId),
  });

  for (const result of await migrateToLatest(db)) {
    app.log.info({ migration: result.migrationName, status: result.status }, "Database migration");
  }
  await deleteExpiredSessions(db);
  // The app's loader, so loads of the notifier, the daily summary and the routes at the same time query the broker once.
  const { overview } = app;

  if (!cipher) {
    app.log.warn(
      "MASTER_KEY is not set: setup, login and stored credentials are unavailable (openssl rand -base64 32)",
    );
  } else if (adapters.broker.id === "demo") {
    if (await seedDemoAccounts(db, cipher)) app.log.info("Demo accounts added");
    if (await seedDemoChallenges(db)) app.log.info("Demo challenge profiles added");
  }
  // Parameter sets saved before they were encrypted at rest; changes nothing once done.
  if (cipher) await encryptStoredParameters(db, cipher, app.log);

  const poller = new AccountPoller({
    db,
    adapters,
    accounts,
    log: app.log,
    statsIntervalMs: config.accountPollSeconds * 1000,
  });
  tradingDays.sync = (accountId) => poller.syncTradingDays(accountId);
  const notifier = new AlertNotifier({
    db,
    load: () => overview.overview(),
    ...(config.alertWebhookUrl ? { webhookUrl: config.alertWebhookUrl } : {}),
    ...(config.heartbeatUrl ? { heartbeatUrl: config.heartbeatUrl } : {}),
    locale: config.defaultLocale,
    log: app.log,
    intervalMs: config.alertCheckSeconds * 1000,
  });
  const lossGuard = new LossGuardService({
    db,
    adapters,
    accounts,
    labelPrefix: config.labelPrefix,
    log: app.log,
    intervalMs: config.accountPollSeconds * 1000,
  });
  const maintenance = new Maintenance({
    db,
    log: app.log,
    auditRetentionDays: config.auditRetentionDays,
    ...(config.backup.intervalHours > 0 ? { backup: config.backup } : {}),
  });
  // The demo runtime reports its own time sync; a real host's clock is measured against CLOCK_CHECK_URL.
  const clock =
    config.clockCheckUrl && adapters.runtime.id !== "demo"
      ? new ClockCheck({ url: config.clockCheckUrl, log: app.log })
      : undefined;
  const summary =
    config.dailySummary && config.alertWebhookUrl
      ? new DailySummary({
          db,
          load: () => overview.overview(),
          webhookUrl: config.alertWebhookUrl,
          ...config.dailySummary,
          locale: config.defaultLocale,
          log: app.log,
        })
      : undefined;
  // Starts managed instances again that a host or Docker restart ended (see the class for the rules).
  const keeper = new InstanceKeeper({ db, runtime: adapters.runtime, log: app.log });
  app.addHook("onClose", () => {
    keeper.stop();
    clock?.stop();
    summary?.stop();
    poller.stop();
    notifier.stop();
    maintenance.stop();
    lossGuard.stop();
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
  notifier.start();
  maintenance.start();
  lossGuard.start();
  keeper.start();
  clock?.start();
  summary?.start();
  // In the background: reading an algo can take a few seconds (the cTrader CLI may run in a helper container).
  refreshAlgoMetadata({ db, broker: adapters.broker, algosDir: config.algosDir, log: app.log }).catch(
    (error: unknown) => {
      app.log.warn({ err: error }, "Algo metadata refresh failed");
    },
  );
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
