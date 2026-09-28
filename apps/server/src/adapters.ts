import { dirname } from "node:path";
import { CbotsetConfigAdapter } from "@wickwatch/adapter-cbotset";
import { createDemoAdapters } from "@wickwatch/adapter-demo";
import { CtraderCliBroker, DEFAULT_CTRADER_IMAGE, toolRunner } from "@wickwatch/adapter-ctrader-cli";
import { DockerRuntimeAdapter } from "@wickwatch/adapter-docker";
import type { BrokerAdapter, ConfigAdapter, RuntimeAdapter } from "@wickwatch/core";
import { ConfigError, type Config } from "./config";
import { withLogEvents } from "./services/log-tracker";

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

  const runtime: Registry<RuntimeAdapter> = {
    demo: () => getDemo().runtime,
    docker: () =>
      new DockerRuntimeAdapter({
        labelPrefix: config.labelPrefix,
        restartPolicy: config.instanceRestartPolicy,
        ...(config.dockerHost ? { dockerHost: config.dockerHost } : {}),
        // Disk usage is reported for the file system holding the database.
        ...(config.database.filename === ":memory:" ? {} : { diskPath: dirname(config.database.filename) }),
      }),
  };
  const problems: string[] = [];
  const pick = <T>(name: string, registry: Registry<T>, selected: string): T | undefined => {
    const factory = registry[selected];
    if (!factory) problems.push(`${name} "${selected}" is unknown; available: ${Object.keys(registry).join(", ")}`);
    return factory?.();
  };

  const selectedRuntime = pick("RUNTIME_ADAPTER", runtime, config.adapters.runtime);
  const broker: Registry<BrokerAdapter> = {
    demo: () => getDemo().broker,
    "ctrader-cli": () => {
      const image = config.ctraderImage ?? DEFAULT_CTRADER_IMAGE;
      if (config.ctraderCli === "local") return new CtraderCliBroker({ binary: config.ctraderCliPath, image });
      // In the Wickwatch image: the CLI of the official image, in a throwaway container per call or session.
      const runTool = selectedRuntime?.runTool?.bind(selectedRuntime);
      if (!runTool) problems.push("CTRADER_CLI=container needs a runtime that runs tools, e.g. RUNTIME_ADAPTER=docker");
      return new CtraderCliBroker({ image, ...(runTool ? { runner: toolRunner(runTool, image) } : {}) });
    },
  };
  const configAdapters: Registry<ConfigAdapter> = {
    demo: () => getDemo().config,
    cbotset: () => new CbotsetConfigAdapter(),
  };

  const adapters = {
    runtime: selectedRuntime,
    broker: pick("BROKER_ADAPTER", broker, config.adapters.broker),
    config: pick("CONFIG_ADAPTER", configAdapters, config.adapters.config),
  };
  if (problems.length || !adapters.runtime || !adapters.broker || !adapters.config) throw new ConfigError(problems);
  const { broker: b } = adapters;
  const logs = { logEvent: b.logEvent?.bind(b), redactLog: b.redactLog?.bind(b) };
  return { runtime: withLogEvents(adapters.runtime, logs), broker: adapters.broker, config: adapters.config };
}
