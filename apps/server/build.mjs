// Bundles the server with the workspace packages (@wickwatch/*, shipped as TypeScript source).
// Third-party runtime dependencies stay external and are installed in the image.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
  logLevel: "info",
});
