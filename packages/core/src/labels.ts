import type { Labels } from "./schemas";

/** Default prefix for runtime discovery labels, e.g. `wickwatch.instance`. */
export const DEFAULT_LABEL_PREFIX = "wickwatch";

export const LABEL_KEYS = [
  "instance",
  "account",
  "prop",
  "symbol",
  "period",
  "set",
  "algo-version",
  // How trades are attributed to the instance, see attribution.ts.
  "attribution",
  "order-label",
  // Set on instances Wickwatch created; only those may be changed or removed through it.
  "managed",
  "config-version",
  // Helper containers (e.g. a broker CLI); never instances.
  "tool",
] as const;
export type LabelKey = (typeof LABEL_KEYS)[number];
export type LabelValues = Partial<Record<LabelKey, string>>;

export function labelKey(prefix: string, key: LabelKey): string {
  return `${prefix}.${key}`;
}

export function buildLabels(prefix: string, values: LabelValues): Labels {
  const labels: Labels = {};
  for (const key of LABEL_KEYS) {
    const value = values[key];
    if (value !== undefined) labels[labelKey(prefix, key)] = value;
  }
  return labels;
}

export function readLabels(prefix: string, labels: Labels): LabelValues {
  const values: LabelValues = {};
  for (const key of LABEL_KEYS) {
    const value = labels[labelKey(prefix, key)];
    if (value !== undefined) values[key] = value;
  }
  return values;
}

export interface ManagedLabelInput {
  name: string;
  account: string;
  symbol: string;
  period: string;
  algoVersion: string;
  configVersion: number;
  attribution: string;
  orderLabel?: string | undefined;
}

/** Labels of an instance Wickwatch creates; `config-version` tells which configuration it runs. */
export function managedLabels(prefix: string, input: ManagedLabelInput): Labels {
  return buildLabels(prefix, {
    instance: input.name,
    account: input.account,
    symbol: input.symbol,
    period: input.period,
    "algo-version": input.algoVersion,
    attribution: input.attribution,
    ...(input.orderLabel ? { "order-label": input.orderLabel } : {}),
    managed: "true",
    "config-version": String(input.configVersion),
  });
}
