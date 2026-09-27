import type { BrokerAdapter, Credentials, RuntimeAdapter } from "./adapters";
import { readLabels } from "./labels";
import type { EmergencyStopReport } from "./schemas";

export interface EmergencyStopOptions {
  runtime: RuntimeAdapter;
  broker: BrokerAdapter;
  credentials: Credentials;
  account: string;
  labelPrefix: string;
}

/**
 * Stops every instance of the account first, so no bot opens new trades,
 * then closes all positions and cancels all pending orders at the broker.
 * The broker step runs even if some instances could not be stopped.
 */
export async function emergencyStopAccount(options: EmergencyStopOptions): Promise<EmergencyStopReport> {
  const { runtime, broker, credentials, account, labelPrefix } = options;
  const instances = (await runtime.list()).filter(
    (i) => i.status !== "stopped" && readLabels(labelPrefix, i.labels).account === account,
  );
  const results = await Promise.allSettled(instances.map((i) => runtime.stop(i.ref)));
  const stoppedInstances = instances.filter((_, n) => results[n]?.status === "fulfilled").map((i) => i.ref);
  const failedInstances = instances.filter((_, n) => results[n]?.status === "rejected").map((i) => i.ref);

  const { closed, cancelled } = await broker.emergencyStop(credentials, account);
  return { stoppedInstances, failedInstances, closed, cancelled };
}
