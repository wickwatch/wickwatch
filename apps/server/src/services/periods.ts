/**
 * The adapter's own spelling of a period given in any case (`H1` for `h1`): a period from a form or a container label
 * need not match it exactly. Undefined for one the adapter does not offer.
 */
export function findPeriod(periods: readonly string[], input: string): string | undefined {
  const wanted = input.toLowerCase();
  return periods.find((p) => p.toLowerCase() === wanted);
}
