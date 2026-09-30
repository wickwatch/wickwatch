import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** Files that read settings: config.ts and the adapters' own (see readAdapterSettings in adapters.ts). */
const sources = ["apps/server/src/config.ts", "packages/adapter-ctrader-cli/src/settings.ts"];
/** Every variable they read, e.g. get("PORT") or integer("BACKUP_KEEP", …). */
const variables = sources.flatMap((file) =>
  [...read(file).matchAll(/(?:get|integer)\("([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1] ?? ""),
);

describe("configuration docs", () => {
  it("finds the variables in config.ts and the adapters' settings", () => {
    expect(variables).toContain("MASTER_KEY");
    expect(variables).toContain("BACKUP_KEEP");
    expect(variables).toContain("CTRADER_CLI_PATH");
  });

  it("documents every variable in docs/CONFIGURATION.md and .env.example", () => {
    const docs = read("docs/CONFIGURATION.md");
    const example = read(".env.example");
    expect(variables.filter((name) => !docs.includes(`\`${name}\``))).toEqual([]);
    // Set or commented out (# NAME=…), so every setting can be found in the example.
    expect(variables.filter((name) => !new RegExp(`^#? ?${name}=`, "m").test(example))).toEqual([]);
  });
});
