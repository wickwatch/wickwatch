// Writes the OpenAPI document to docs/openapi.json, so the API can be read and reviewed in the repo.
// Run with `pnpm --filter @wickwatch/server openapi`; a test fails when the file is out of date.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderOpenApi } from "../src/openapi-document";

const target = fileURLToPath(new URL("../../../docs/openapi.json", import.meta.url));
writeFileSync(target, await renderOpenApi());
console.log(`Wrote ${target}`);
