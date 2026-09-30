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
import { auditRoutes } from "./routes/audit";
import { challengeRoutes } from "./routes/challenges";
import { authRoutes } from "./routes/auth";
import { credentialRoutes } from "./routes/credentials";
import { healthRoutes } from "./routes/health";
import { instanceRoutes } from "./routes/instances";
import { managedInstanceRoutes } from "./routes/managed-instances";
import { overviewRoutes } from "./routes/overview";
import { systemRoutes } from "./routes/system";
import { createCipher } from "./security/cipher";
import { createDealHistory } from "./services/deal-history";
import { LogTracker } from "./services/log-tracker";
import { createSymbolCache } from "./services/symbols";

export interface AppDeps {
  config: Config;
  db: Db;
  adapters: Adapters;
  version: string;
  /** First-run state; main.ts prints its token when no user exists yet. */
  setup?: SetupState;
  /** Overrides pino options, e.g. `false` in tests. */
  logger?: boolean;
  /** Shared with the alert notifier, so both see the same log state. */
  logTracker?: LogTracker;
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
  logTracker = new LogTracker(adapters.runtime),
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

  await app.register(errors);
  await app.register(rateLimit, { global: false });
  await app.register(auth, { db, basePath });
  await app.register(openapi, { basePath, version });

  // Health is also reachable at the root, for proxies that strip or ignore the base path.
  await app.register(healthRoutes, { db, version });
  if (basePath) await app.register(healthRoutes, { db, version, prefix: basePath });

  const api = `${basePath}/api/v1`;
  await app.register(authRoutes, { db, cipher, setup, basePath, prefix: `${api}/auth` });
  await app.register(systemRoutes, { config, adapters, version, prefix: api });
  await app.register(overviewRoutes, { adapters, accounts, db, labelPrefix, logTracker, prefix: api });
  await app.register(instanceRoutes, { adapters, accounts, db, labelPrefix, logTracker, history, prefix: api });
  await app.register(credentialRoutes, { db, cipher, adapters, prefix: api });
  await app.register(accountRoutes, { adapters, accounts, db, cipher, labelPrefix, symbols, prefix: api });
  const templates = await loadChallengeTemplates(config.challengeTemplatesDir, app.log);
  await app.register(challengeRoutes, {
    db,
    templates,
    ...(onChallengeSaved ? { onSaved: onChallengeSaved } : {}),
    prefix: api,
  });
  await app.register(algoRoutes, { db, adapters, algosDir: config.algosDir, prefix: api });
  await app.register(auditRoutes, { db, prefix: api });
  await app.register(managedInstanceRoutes, {
    adapters,
    accounts,
    db,
    symbols,
    labelPrefix,
    algosDir: config.algosDir,
    prefix: api,
  });
  await app.register(web, { basePath, distDir: config.webDistDir });

  app.addHook("onClose", async () => {
    await adapters.broker.dispose?.();
    await db.destroy();
  });

  return app;
}
