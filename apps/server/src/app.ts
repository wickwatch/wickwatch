import rateLimit from "@fastify/rate-limit";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { dbAccountDirectory } from "./accounts";
import type { Adapters } from "./adapters";
import { SetupState } from "./auth/setup";
import type { Config } from "./config";
import type { Db } from "./db";
import { auth } from "./plugins/auth";
import { errors } from "./plugins/errors";
import { openapi } from "./plugins/openapi";
import { web } from "./plugins/web";
import { loadChallengeTemplates } from "./challenges/templates";
import { accountRoutes } from "./routes/accounts";
import { algoRoutes } from "./routes/algos";
import { apiTokenRoutes } from "./routes/api-tokens";
import { auditRoutes } from "./routes/audit";
import { challengeRoutes } from "./routes/challenges";
import { authRoutes } from "./routes/auth";
import { credentialRoutes } from "./routes/credentials";
import { healthRoutes } from "./routes/health";
import { instanceRoutes } from "./routes/instances";
import { managedInstanceRoutes } from "./routes/managed-instances";
import { mcpRoutes } from "./routes/mcp";
import { overviewRoutes } from "./routes/overview";
import { parameterTemplateRoutes } from "./routes/parameter-templates";
import { systemRoutes } from "./routes/system";
import { createCipher } from "./security/cipher";
import { createDealHistory } from "./services/deal-history";
import { LogTracker } from "./services/log-tracker";
import { MarketHoursCache } from "./services/market-hours";
import { OverviewLoader } from "./services/overview";
import { createSecurityNotifier } from "./services/security-notice";
import { createSymbolCache } from "./services/symbols";

declare module "fastify" {
  interface FastifyInstance {
    /** Shared by the routes, the notifier and the daily summary, so concurrent loads query runtime and broker once. */
    overview: OverviewLoader;
    /** Trading hours of the instances' symbols, asked in the background. */
    marketHours: MarketHoursCache;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  adapters: Adapters;
  version: string;
  /** First-run state; main.ts prints its token when no user exists yet. */
  setup?: SetupState;
  /** Overrides pino options, e.g. `false` in tests. */
  logger?: boolean;
  /** Called after a challenge profile was saved, so the poller marks its trading days right away. */
  onChallengeSaved?: (accountId: number) => void;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

export async function buildApp({
  config,
  db,
  adapters,
  version,
  setup = new SetupState(),
  logger,
  onChallengeSaved,
}: AppDeps) {
  const { trustProxy } = config;
  const app = Fastify({
    // A hop count is supported at runtime but missing from Fastify's types.
    trustProxy: typeof trustProxy === "number" ? (_address: string, hop: number) => hop < trustProxy : trustProxy,
    logger: logger ?? {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    },
  })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler);

  const { basePath, labelPrefix } = config;
  const cipher = config.masterKey ? createCipher(config.masterKey) : undefined;
  const accounts = dbAccountDirectory(db, cipher, adapters.broker.id);
  const symbols = createSymbolCache(adapters.broker);
  const history = createDealHistory(adapters.broker, app.log);
  const logTracker = new LogTracker(adapters.runtime);
  const marketHours = new MarketHoursCache({ adapters, log: app.log });
  const overview = new OverviewLoader({
    adapters,
    directory: accounts,
    db,
    labelPrefix,
    logTracker,
    log: app.log,
    marketHours,
  });
  app.decorate("overview", overview);
  app.decorate("marketHours", marketHours);

  await app.register(errors);
  await app.register(rateLimit, { global: false });
  await app.register(auth, { db, basePath, mcp: config.mcp });
  await app.register(openapi, { basePath, version });

  // Health is also reachable at the root, for proxies that strip or ignore the base path.
  await app.register(healthRoutes, { db, version });
  if (basePath) await app.register(healthRoutes, { db, version, prefix: basePath });

  const api = `${basePath}/api/v1`;
  await app.register(authRoutes, { db, cipher, setup, basePath, prefix: `${api}/auth` });
  await app.register(systemRoutes, { config, adapters, version, prefix: api });
  await app.register(overviewRoutes, { adapters, overview, prefix: api });
  await app.register(instanceRoutes, {
    adapters,
    accounts,
    db,
    labelPrefix,
    logTracker,
    history,
    marketHours,
    prefix: api,
  });
  await app.register(credentialRoutes, { db, cipher, adapters, prefix: api });
  await app.register(accountRoutes, { adapters, accounts, db, cipher, labelPrefix, symbols, prefix: api });
  const templates = await loadChallengeTemplates(config.challengeTemplatesDir, app.log);
  await app.register(challengeRoutes, {
    db,
    accounts,
    templates,
    ...(onChallengeSaved ? { onSaved: onChallengeSaved } : {}),
    prefix: api,
  });
  await app.register(algoRoutes, { db, adapters, algosDir: config.algosDir, prefix: api });
  await app.register(parameterTemplateRoutes, { db, cipher, prefix: api });
  await app.register(auditRoutes, { db, prefix: api });
  const notify = config.alertWebhookUrl
    ? createSecurityNotifier({ webhookUrl: config.alertWebhookUrl, locale: config.defaultLocale, log: app.log })
    : undefined;
  await app.register(apiTokenRoutes, {
    db,
    cipher,
    notify,
    require2fa: config.apiTokensRequire2fa,
    prefix: api,
  });
  await app.register(managedInstanceRoutes, {
    adapters,
    accounts,
    db,
    cipher,
    symbols,
    labelPrefix,
    algosDir: config.algosDir,
    prefix: api,
  });
  // Off with MCP=off: then there is no route, and <base>/mcp answers 404 like any unknown path.
  if (config.mcp) {
    await app.register(mcpRoutes, {
      path: `${basePath}/mcp`,
      version,
      adapters,
      accounts,
      db,
      overview,
      labelPrefix,
      logTracker,
      history,
      marketHours,
    });
  }
  await app.register(web, { basePath, distDir: config.webDistDir });

  app.addHook("onClose", async () => {
    await adapters.broker.dispose?.();
    await db.destroy();
  });

  return app;
}
