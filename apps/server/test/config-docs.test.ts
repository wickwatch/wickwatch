import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** Every variable config.ts reads, e.g. get("PORT") or integer("BACKUP_KEEP", …). */
const variables = [...read("apps/server/src/config.ts").matchAll(/(?:get|integer)\("([A-Z][A-Z0-9_]*)"/g)].map(
  (m) => m[1] ?? "",
);

describe("configuration docs", () => {
  it("finds the variables in config.ts", () => {
    expect(variables).toContain("MASTER_KEY");
    expect(variables).toContain("BACKUP_KEEP");
  });

  it("documents every variable in docs/CONFIGURATION.md and .env.example", () => {
    const docs = read("docs/CONFIGURATION.md");
    const example = read(".env.example");
    expect(variables.filter((name) => !docs.includes(`\`${name}\``))).toEqual([]);
    // Set or commented out (# NAME=…), so every setting can be found in the example.
    expect(variables.filter((name) => !new RegExp(`^#? ?${name}=`, "m").test(example))).toEqual([]);
  });
});
