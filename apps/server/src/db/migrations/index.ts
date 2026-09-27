import type { Migration } from "kysely/migration";
import { initial } from "./0001-initial";

// Migrations are imported statically so they end up in the server bundle.
// Keys sort lexicographically and define the order; never rename or remove one.
export const migrations: Record<string, Migration> = {
  "0001-initial": initial,
};
