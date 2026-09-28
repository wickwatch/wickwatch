import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

interface Row {
  id: number;
  metadata: string;
}

const channel = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;

/** `{ A, R, G, B }` → `#AARRGGBB`, as the cTrader adapter now reads colour defaults. */
function hex(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { A, R, G, B } = value as Record<string, unknown>;
  if (![A, R, G, B].every(channel)) return undefined;
  return `#${[A, R, G, B].map((v) => (v as number).toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

export const colorParameters: Migration = {
  // Algos uploaded before the parameter type `color` existed stored colour parameters as `string`
  // with an object as default, which the forms could not show. Their metadata is repaired here.
  async up(db: Kysely<unknown>) {
    const typed = db as unknown as Kysely<{ algos: Row }>;
    const rows = await typed.selectFrom("algos").select(["id", "metadata"]).execute();
    for (const row of rows) {
      const metadata = JSON.parse(row.metadata) as { parameters?: Record<string, unknown>[] };
      let changed = false;
      for (const param of metadata.parameters ?? []) {
        const color = param["type"] === "string" ? hex(param["default"]) : undefined;
        if (!color) continue;
        param["type"] = "color";
        param["default"] = color;
        changed = true;
      }
      if (changed) {
        await typed
          .updateTable("algos")
          .set({ metadata: JSON.stringify(metadata) })
          .where("id", "=", row.id)
          .execute();
      }
    }
  },

  async down() {
    // Nothing to undo: `color` metadata stays valid.
  },
};
