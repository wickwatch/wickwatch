import type { Labels } from "./schemas";

/** Default prefix for runtime discovery labels, e.g. `wickwatch.instance`. */
export const DEFAULT_LABEL_PREFIX = "wickwatch";

export const LABEL_KEYS = ["instance", "account", "prop", "symbol", "period", "set", "algo-version"] as const;
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
