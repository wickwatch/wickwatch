import { CLOCK_TOLERANCE_MS, type HostStatus } from "@wickwatch/core";
import type { Adapters } from "../adapters";
import { clockCheckState, clockOffset } from "./clock-check";

/** CPU, memory, disk and time sync of the host. */
export async function loadHostStatus(adapters: Adapters): Promise<HostStatus> {
  const host = await adapters.runtime.hostStatus();
  // Runtimes that cannot see the host's time sync get the measured clock offset instead (services/clock-check.ts).
  if (host.ntpSynced !== undefined) return host;
  const offset = clockOffset();
  if (offset === undefined) {
    const state = clockCheckState();
    return state ? { ...host, clockCheck: state } : host;
  }
  return { ...host, ntpSynced: Math.abs(offset) <= CLOCK_TOLERANCE_MS, clockOffsetMs: offset };
}
