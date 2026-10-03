import type { LogPeriod } from "@wickwatch/core";

/** How far back a log download or a search of the whole log goes, in the order the menus offer them. */
export const LOG_PERIODS: readonly LogPeriod[] = ["24h", "7d", "all"];
