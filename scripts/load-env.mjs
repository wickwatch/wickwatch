// Preloaded by `pnpm start` and `pnpm dev:server` (node --import). Loads the repo's .env and, unlike
// node --env-file, lets its values win over variables already exported in the shell, so a stale export
// cannot silently replace what .env says. Names of replaced variables are printed, never their values.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const file = new URL("../.env", import.meta.url);
if (existsSync(file)) {
  const values = parseEnv(readFileSync(file, "utf8"));
  const replaced = Object.keys(values).filter((name) => name in process.env && process.env[name] !== values[name]);
  if (replaced.length) console.warn(`.env replaces exported shell variables: ${replaced.join(", ")}`);
  Object.assign(process.env, values);
}
