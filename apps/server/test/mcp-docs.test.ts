import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wickwatchTools, type ToolDeps } from "../src/mcp/tools";

const docs = readFileSync(new URL("../../../docs/MCP.md", import.meta.url), "utf8");
// Building the list touches none of the dependencies; only `run` would.
const tools = wickwatchTools({} as ToolDeps);
/** Rows of the tool table: `| \`name\` | arguments | … | role |`. */
const rows = [...docs.matchAll(/^\| `([a-z_]+)`\s*\|.*\|\s*(viewer|admin)\s*\|$/gm)].map((m) => ({
  name: m[1],
  role: m[2],
}));

describe("docs/MCP.md", () => {
  it("lists every MCP tool with its role, and no others", () => {
    expect(rows).toEqual(tools.map((t) => ({ name: t.name, role: t.adminOnly ? "admin" : "viewer" })));
  });

  it("documents every argument of each tool", () => {
    for (const tool of tools) {
      const row = docs.split("\n").find((line) => new RegExp(`^\\| \`${tool.name}\`\\s*\\|`).test(line)) ?? "";
      const args = row.split("|")[2] ?? "";
      const names = Object.keys((tool.input as { properties?: object }).properties ?? {});
      expect(
        names.filter((n) => !args.includes(`\`${n}\``)),
        tool.name,
      ).toEqual([]);
    }
  });
});
