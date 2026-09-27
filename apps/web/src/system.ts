import type { SystemInfo } from "@wickwatch/core";
import { shallowRef } from "vue";
import { api } from "./api";
import { applyServerDefault } from "./i18n";

/** Loaded once at start: version, default locale, adapter capabilities. */
export const system = shallowRef<SystemInfo>();

export async function loadSystem(): Promise<void> {
  try {
    system.value = await api.system();
    applyServerDefault(system.value.defaultLocale);
  } catch {
    // The overview shows connection problems; capabilities default to hidden features.
  }
}
