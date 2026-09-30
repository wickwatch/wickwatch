// Dependency-free, so the SPA can import it at runtime (`@wickwatch/core/group-by`).

/** Items by key, in the order in which the keys first appear; each group keeps the order of its items. */
export function groupBy<T, K>(items: Iterable<T>, key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
