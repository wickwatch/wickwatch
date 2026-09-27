import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError } from "@wickwatch/core";

export interface CliOptions {
  /** Executable, default `ctrader-cli`. */
  binary: string;
  /** Arguments put before every call (tests run a fake CLI through node). */
  binaryArgs?: string[];
  /** Per batch call and per shell command. */
  commandTimeoutMs: number;
  /** Login and broker connection of a shell session. */
  connectTimeoutMs: number;
  /** A shell session without commands for this long is closed. */
  sessionIdleMs: number;
}

export const DEFAULT_CLI_OPTIONS: CliOptions = {
  binary: "ctrader-cli",
  commandTimeoutMs: 60_000,
  connectTimeoutMs: 60_000,
  sessionIdleMs: 10 * 60_000,
};

/**
 * The password goes to the CLI only through a file (`--pwd-file`), never as an argument,
 * so it is not visible in `ps` or `docker inspect`. The file lives in a private temp directory.
 */
export class SecretFile {
  private constructor(
    readonly path: string,
    private readonly dir: string,
  ) {}

  static async create(secret: string): Promise<SecretFile> {
    const dir = await mkdtemp(join(tmpdir(), "wickwatch-ctrader-"));
    await chmod(dir, 0o700);
    const path = join(dir, "pwd");
    await writeFile(path, secret, { mode: 0o600 });
    return new SecretFile(path, dir);
  }

  async remove(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

export interface BatchResult {
  code: number | null;
  output: string;
}

/** Runs one batch command (accounts, symbols, metadata …) and returns stdout and stderr combined. */
export function runBatch(options: CliOptions, args: string[]): Promise<BatchResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, [...(options.binaryArgs ?? []), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AdapterError("timeout", `cTrader CLI did not answer within ${String(options.commandTimeoutMs)} ms`));
    }, options.commandTimeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new AdapterError("unavailable", `cTrader CLI could not be started: ${error.message}`, { cause: error }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/**
 * Finds the JSON document in CLI output. Status lines come first; the echo line
 * `[2026-09-27 17:11:23 +02:00] accounts` also starts with "[", so it must not be taken for JSON.
 * Text after the document (a prompt, "Bye.") is ignored.
 */
export function extractJson(output: string): unknown {
  // A document starts with "{", or with "[" followed by a line break, "{" or a string – never "[2026-…".
  const match = /^(\{|\[\s*$|\[\s*[{"])/m.exec(output);
  if (!match) throw new AdapterError("unavailable", "cTrader CLI returned no JSON");
  const text = output.slice(match.index);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(0, i + 1));
        } catch (error) {
          throw new AdapterError("unavailable", "cTrader CLI returned malformed JSON", { cause: error });
        }
      }
    }
  }
  throw new AdapterError("unavailable", "cTrader CLI returned incomplete JSON");
}

/** Translates CLI messages into adapter errors. Messages are kept for logs; they contain no secrets. */
export function cliError(output: string, fallback = "cTrader CLI failed"): AdapterError {
  const line =
    output
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^(error:|account .* is not|missing |unable |account selection)/i.test(l)) ?? fallback;
  if (/is not linked to this cTID/i.test(line)) return new AdapterError("not_found", line);
  // Shown for closed or disabled accounts, despite the wording.
  if (/not available on this cTrader build/i.test(line))
    return new AdapterError("unavailable", `Account not active: ${line}`);
  if (/not found/i.test(line)) return new AdapterError("not_found", line);
  if (/^missing |required|unable to determine/i.test(line)) return new AdapterError("invalid_input", line);
  if (!/logged in\./i.test(output) && /connecting as/i.test(output)) {
    return new AdapterError("auth_failed", "cTrader ID login failed");
  }
  return new AdapterError("unavailable", line);
}
