import { createDemoAdapters, DEMO_ACCOUNTS } from "@wickwatch/adapter-demo";
import type { BrokerAdapter, ConfigAdapter, RuntimeAdapter } from "@wickwatch/core";
import type { AccountDirectory } from "./accounts";
import { ConfigError, type Config } from "./config";

export interface Adapters {
  runtime: RuntimeAdapter;
  broker: BrokerAdapter;
  config: ConfigAdapter;
  accounts: AccountDirectory;
}

/** Demo accounts need no stored credentials; the demo broker accepts any login. */
const demoAccounts: AccountDirectory = {
  list: () =>
    Promise.resolve(
      DEMO_ACCOUNTS.map((a) => ({
        number: a.number,
        displayName: a.displayName,
        credentialLabel: a.credentialLabel,
        credentials: () => Promise.resolve({ login: "demo", secret: "demo" }),
      })),
    ),
};

type Registry<T> = Record<string, (() => T) | undefined>;

/** The only place that knows concrete adapter implementations. */
export function createAdapters(config: Config): Adapters {
  let demo: ReturnType<typeof createDemoAdapters> | undefined;
  const getDemo = () => (demo ??= createDemoAdapters({ labelPrefix: config.labelPrefix }));

  const runtime: Registry<RuntimeAdapter> = { demo: () => getDemo().runtime };
  const broker: Registry<BrokerAdapter> = { demo: () => getDemo().broker };
  const configAdapters: Registry<ConfigAdapter> = { demo: () => getDemo().config };

  const problems: string[] = [];
  const pick = <T>(name: string, registry: Registry<T>, selected: string): T | undefined => {
    const factory = registry[selected];
    if (!factory) problems.push(`${name} "${selected}" is unknown; available: ${Object.keys(registry).join(", ")}`);
    return factory?.();
  };

  const adapters = {
    runtime: pick("RUNTIME_ADAPTER", runtime, config.adapters.runtime),
    broker: pick("BROKER_ADAPTER", broker, config.adapters.broker),
    config: pick("CONFIG_ADAPTER", configAdapters, config.adapters.config),
  };
  if (!adapters.runtime || !adapters.broker || !adapters.config) throw new ConfigError(problems);
  // Accounts stored in the database (with encrypted credentials) replace this once real brokers exist.
  const accounts = config.adapters.broker === "demo" ? demoAccounts : undefined;
  if (!accounts) throw new ConfigError(["Only the demo broker adapter is available so far"]);
  return { runtime: adapters.runtime, broker: adapters.broker, config: adapters.config, accounts };
}
