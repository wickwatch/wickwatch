import type { Migration } from "kysely/migration";
import { initial } from "./0001-initial";
import { sessions } from "./0002-sessions";
import { challenges } from "./0003-challenges";
import { attributionOverrides } from "./0004-attribution-overrides";
import { algos } from "./0005-algos";

// Migrations are imported statically so they end up in the server bundle.
// Keys sort lexicographically and define the order; never rename or remove one.
export const migrations: Record<string, Migration> = {
  "0001-initial": initial,
  "0002-sessions": sessions,
  "0003-challenges": challenges,
  "0004-attribution-overrides": attributionOverrides,
  "0005-algos": algos,
};
