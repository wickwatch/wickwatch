import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterError, type ToolProcess, type ToolSpec } from "@wickwatch/core";

/** A file the CLI needs: its content (e.g. a password) or a file that already exists on this machine. */
export type CliFile = { name: string; mode: number } & ({ content: string | Uint8Array } | { path: string });

/** `path(name)`: where the CLI sees one of the files it was started with. */
export type CliArguments = (path: (name: string) => string) => string[];

/** Starts the cTrader CLI: as a local program, or through the runtime (e.g. in the official image). */
export interface CliRunner {
  /** `purpose` names the call, e.g. `session-1234567`; a runtime may show it in the tool's name. */
  start(args: CliArguments, files: CliFile[], purpose?: string): Promise<ToolProcess>;
}

/**
 * The CLI installed where wickwatch runs. Files with content go to a private temp directory that
 * is removed when the CLI ends; the password is never an argument, so `ps` does not show it.
 */
export function localRunner(binary: string, binaryArgs: string[] = []): CliRunner {
  return {
    async start(args, files) {
      const dir = await mkdtemp(join(tmpdir(), "wickwatch-ctrader-"));
      await chmod(dir, 0o700);
      const paths = new Map<string, string>();
      try {
        for (const file of files) {
          if ("path" in file) {
            paths.set(file.name, file.path);
          } else {
            const path = join(dir, file.name);
            await writeFile(path, file.content, { mode: file.mode });
            paths.set(file.name, path);
          }
        }
        const child = spawn(binary, [...binaryArgs, ...args((name) => paths.get(name) ?? join(dir, name))], {
          stdio: "pipe",
        });
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", (error) => {
            reject(
              new AdapterError("unavailable", `cTrader CLI could not be started: ${error.message}`, { cause: error }),
            );
          });
        });
        const listeners: ((text: string) => void)[] = [];
        const emit = (d: Buffer) => {
          for (const listener of listeners) listener(d.toString());
        };
        child.stdout.on("data", emit);
        child.stderr.on("data", emit);
        // stdin may close before a last write; the exit code tells what happened.
        child.stdin.on("error", () => undefined);
        const exit = new Promise<number | null>((resolve) => {
          child.once("close", (code) => {
            void rm(dir, { recursive: true, force: true }).then(() => {
              resolve(code);
            });
          });
        });
        return {
          write: (text) => child.stdin.write(text),
          onOutput: (listener) => listeners.push(listener),
          exit,
          kill: () => child.kill("SIGKILL"),
        };
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    },
  };
}

/** Where tool files are placed inside the helper container. */
const TOOL_DIR = "/mnt/wickwatch";

/**
 * The CLI of the official image, run by the runtime (e.g. a throwaway container), so the
 * wickwatch image does not have to contain the proprietary CLI. Local files are copied in.
 */
export function toolRunner(runTool: (spec: ToolSpec) => Promise<ToolProcess>, image: string): CliRunner {
  return {
    async start(args, files, purpose) {
      const place = (name: string) => `${TOOL_DIR}/${name}`;
      const contents = await Promise.all(
        files.map(async (file) => {
          if (!("path" in file)) return file.content;
          try {
            return await readFile(file.path);
          } catch (error) {
            throw new AdapterError("not_found", `Cannot read ${file.name}`, { cause: error });
          }
        }),
      );
      return runTool({
        image,
        command: args(place),
        ...(purpose ? { purpose } : {}),
        files: files.map((file, i) => {
          const content = contents[i] ?? "";
          return {
            path: place(file.name),
            content: typeof content === "string" ? new TextEncoder().encode(content) : content,
            mode: file.mode,
          };
        }),
      });
    },
  };
}
