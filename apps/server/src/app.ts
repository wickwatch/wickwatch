import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import type { Adapters } from "./adapters";
import type { Config } from "./config";
import type { Db } from "./db";
import { errors } from "./plugins/errors";
import { openapi } from "./plugins/openapi";
import { web } from "./plugins/web";
import { accountRoutes } from "./routes/accounts";
import { healthRoutes } from "./routes/health";
import { instanceRoutes } from "./routes/instances";
import { overviewRoutes } from "./routes/overview";
import { systemRoutes } from "./routes/system";

export interface AppDeps {
  config: Config;
  db: Db;
  adapters: Adapters;
  version: string;
  /** Overrides pino options, e.g. `false` in tests. */
  logger?: boolean;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

export async function buildApp({ config, db, adapters, version, logger }: AppDeps) {
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
  await app.register(errors);
  await app.register(openapi, { basePath, version });

  // Health is also reachable at the root, for proxies that strip or ignore the base path.
  await app.register(healthRoutes, { db, version });
  if (basePath) await app.register(healthRoutes, { db, version, prefix: basePath });

  const api = `${basePath}/api/v1`;
  await app.register(systemRoutes, { config, adapters, version, prefix: api });
  await app.register(overviewRoutes, { adapters, labelPrefix, prefix: api });
  await app.register(instanceRoutes, { adapters, db, prefix: api });
  await app.register(accountRoutes, { adapters, db, labelPrefix, prefix: api });
  await app.register(web, { basePath, distDir: config.webDistDir });

  app.addHook("onClose", async () => {
    await db.destroy();
  });

  return app;
}
