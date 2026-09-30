import type { Deal } from "./schemas";

/** Result of a deal in the account currency, including commission and swap. */
export const dealResult = (deal: Deal) => deal.pnl + (deal.commission ?? 0) + (deal.swap ?? 0);

export const round2 = (value: number) => Math.round(value * 100) / 100;
