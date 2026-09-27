import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderOpenApi } from "../src/openapi-document";

describe("docs/openapi.json", () => {
  it("matches the API (run `pnpm --filter @wickwatch/server openapi` after API changes)", async () => {
    const committed = readFileSync(new URL("../../../docs/openapi.json", import.meta.url), "utf8");
    expect(JSON.parse(committed)).toEqual(JSON.parse(await renderOpenApi()));
  });
});
