import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolSpec } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CtraderCliBroker, localRunner, toolRunner } from "../src";

const FAKE = join(__dirname, "fake-cli.mjs");
const IMAGE = "ghcr.io/spotware/ctrader-console:5.9.11";
const c = { login: "user@example.com", secret: "correct horse" };

let specs: ToolSpec[];
let broker: CtraderCliBroker;

/** Stands in for the runtime: puts the files into a temp dir and runs the fake CLI there. */
async function fakeRunTool(spec: ToolSpec) {
  specs.push(spec);
  const root = mkdtempSync(join(tmpdir(), "ww-tool-"));
  for (const file of spec.files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.content, { mode: file.mode });
  }
  const command = spec.command.map((arg) => arg.replaceAll("/mnt/wickwatch", join(root, "mnt/wickwatch")));
  return localRunner(process.execPath, [FAKE]).start(() => command, []);
}

beforeEach(() => {
  specs = [];
  const log = join(mkdtempSync(join(tmpdir(), "ww-fake-")), "calls.log");
  writeFileSync(log, "");
  process.env["FAKE_CTRADER_LOG"] = log;
  broker = new CtraderCliBroker({
    runner: toolRunner(fakeRunTool, IMAGE),
    commandTimeoutMs: 5000,
    connectTimeoutMs: 5000,
  });
});
afterEach(async () => {
  await broker.dispose();
});

describe("toolRunner", () => {
  it("runs batch commands and shell sessions in the image, with the password only in a file", async () => {
    expect((await broker.accounts(c)).map((a) => a.number)).toEqual(["1111111", "2222222", "5555555"]);
    expect(await broker.stats(c, "1111111")).toMatchObject({ balance: 10138.66 });

    expect(specs.map((s) => s.image)).toEqual(specs.map(() => IMAGE));
    expect(specs[0]?.command).toEqual(["accounts", "--ctid=user@example.com", "--pwd-file=/mnt/wickwatch/pwd"]);
    for (const spec of specs) {
      expect(spec.command.join(" ")).not.toContain(c.secret);
      expect(spec.files).toEqual([
        { path: "/mnt/wickwatch/pwd", content: new TextEncoder().encode(c.secret), mode: 0o400 },
      ]);
    }
  });

  it("copies a local algo into the tool under its own name", async () => {
    const algo = join(mkdtempSync(join(tmpdir(), "ww-algo-")), "bot.algo");
    writeFileSync(algo, "compiled");
    expect((await broker.algoMetadata(algo)).name).toBe("SampleBot");
    expect(specs[0]?.command).toEqual(["metadata", "/mnt/wickwatch/bot.algo"]);
    expect(specs[0]?.files[0]).toMatchObject({ path: "/mnt/wickwatch/bot.algo", mode: 0o444 });

    await expect(broker.algoMetadata("/does/not/exist/bot.algo")).rejects.toMatchObject({ code: "not_found" });
  });
});
