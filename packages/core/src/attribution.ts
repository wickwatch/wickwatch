import { readLabels } from "./labels";
import type { RuntimeInstance } from "./schemas";

/**
 * How positions, orders and deals of an account are attributed to an instance.
 * - `label`: the order label equals the expected label (default: the instance name).
 * - `label-pattern`: the order label matches a regular expression.
 * - `account-symbol`: every trade of the account on the instance's symbol (one bot per account and symbol).
 * - `auto` (default): `label` first; otherwise `account-symbol` if the instance is the only one on
 *   that account and symbol. Bots whose labels cannot be chosen (third-party bots) work this way.
 */
export const ATTRIBUTION_MODES = ["auto", "label", "label-pattern", "account-symbol"] as const;
export type AttributionMode = (typeof ATTRIBUTION_MODES)[number];

export interface TradeItem {
  label?: string | undefined;
  symbol: string;
}

interface Target {
  name: string;
  account: string;
  symbol: string | undefined;
  mode: AttributionMode;
  orderLabel: string;
  pattern: RegExp | undefined;
}

export interface AttributionProblem {
  kind: "ambiguous" | "invalid";
  account: string;
  /** Instance names involved. */
  instances: string[];
  symbol?: string;
}

export interface Attributor {
  /** Name of the instance a trade belongs to, or undefined when it cannot be attributed. */
  owner(account: string, item: TradeItem): string | undefined;
  problems: AttributionProblem[];
}

const sameSymbol = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase() === b.toLowerCase();

export function createAttributor(instances: RuntimeInstance[], labelPrefix: string): Attributor {
  const problems: AttributionProblem[] = [];
  const targets: Target[] = instances.flatMap((instance) => {
    const labels = readLabels(labelPrefix, instance.labels);
    if (!labels.account) return [];
    const name = labels.instance ?? instance.ref;
    const mode = (ATTRIBUTION_MODES as readonly string[]).includes(labels.attribution ?? "")
      ? (labels.attribution as AttributionMode)
      : "auto";
    let pattern: RegExp | undefined;
    if (mode === "label-pattern") {
      try {
        pattern = new RegExp(labels["order-label"] ?? "");
      } catch {
        problems.push({ kind: "invalid", account: labels.account, instances: [name] });
      }
    }
    return [
      {
        name,
        account: labels.account,
        symbol: labels.symbol,
        mode,
        orderLabel: labels["order-label"] ?? name,
        pattern,
      },
    ];
  });

  // Two instances on the same account and symbol cannot both claim "every trade on the symbol".
  const groups = new Map<string, Target[]>();
  for (const t of targets) {
    if (!t.symbol) continue;
    const key = `${t.account}\u0000${t.symbol.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const group of groups.values()) {
    const [first] = group;
    if (first && group.length > 1 && group.some((t) => t.mode === "account-symbol")) {
      problems.push({
        kind: "ambiguous",
        account: first.account,
        ...(first.symbol ? { symbol: first.symbol } : {}),
        instances: group.map((t) => t.name),
      });
    }
  }

  return {
    problems,
    owner(account, item) {
      const onAccount = targets.filter((t) => t.account === account);
      if (item.label) {
        const byLabel = onAccount.find((t) => (t.mode === "auto" || t.mode === "label") && t.orderLabel === item.label);
        if (byLabel) return byLabel.name;
        const byPattern = onAccount.find((t) => t.mode === "label-pattern" && t.pattern?.test(item.label ?? ""));
        if (byPattern) return byPattern.name;
      }
      const onSymbol = onAccount.filter((t) => sameSymbol(t.symbol, item.symbol));
      const only = onSymbol.length === 1 ? onSymbol[0] : undefined;
      return only && (only.mode === "auto" || only.mode === "account-symbol") ? only.name : undefined;
    },
  };
}
