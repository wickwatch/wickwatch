import type { InstanceStatus } from "@wickwatch/core";
import type { ManagedInstanceDetail } from "./api";

/** Running, or about to run again: it can be stopped, and applying a configuration restarts it. */
export const isActive = (status: InstanceStatus | undefined) => status === "running" || status === "restarting";

/** The container Wickwatch created runs another configuration than the saved one. */
export const isOutdated = (managed: ManagedInstanceDetail | undefined): boolean =>
  managed?.deployment?.managed === true && managed.deployment.configVersion !== managed.config.version;

type Translate = (key: string, named: Record<string, unknown>) => string;

/** What an outdated deployment runs, the same on the overview and the configuration tab. */
export function outdatedText(t: Translate, managed: ManagedInstanceDetail): string {
  const version = managed.config.version;
  const running = managed.deployment?.configVersion;
  return running ? t("deploy.outdated", { version, running }) : t("deploy.outdatedUnknown", { version });
}
