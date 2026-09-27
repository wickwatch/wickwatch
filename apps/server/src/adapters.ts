import { createDemoAdapters } from "@wickwatch/adapter-demo";
import type { BrokerAdapter, ConfigAdapter, RuntimeAdapter } from "@wickwatch/core";
import { ConfigError, type Config } from "./config";

export interface Adapters {
  runtime: RuntimeAdapter;
  broker: BrokerAdapter;
  config: ConfigAdapter;
}

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
  return { runtime: adapters.runtime, broker: adapters.broker, config: adapters.config };
}
