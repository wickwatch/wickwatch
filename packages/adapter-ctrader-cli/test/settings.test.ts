import { describe, expect, it } from "vitest";
import { readCtraderCliSettings } from "../src";

const pinned = (image: string) => !image.endsWith(":latest");

function read(env: Record<string, string>) {
  const problems: string[] = [];
  const settings = readCtraderCliSettings((name) => env[name], problems, pinned);
  return { settings, problems };
}

describe("readCtraderCliSettings", () => {
  it("runs the installed CLI with the adapter's image by default", () => {
    expect(read({})).toEqual({ settings: { cli: "local", cliPath: "ctrader-cli" }, problems: [] });
  });

  it("reads mode, path and image", () => {
    const env = { CTRADER_CLI: "container", CTRADER_CLI_PATH: "/opt/ctrader", CTRADER_IMAGE: "registry/ctrader:1.2" };
    expect(read(env).settings).toEqual({ cli: "container", cliPath: "/opt/ctrader", image: "registry/ctrader:1.2" });
  });

  it("reads the idle time of a shell session in seconds", () => {
    expect(read({ CTRADER_SESSION_IDLE_SECONDS: "1800" })).toEqual({
      settings: { cli: "local", cliPath: "ctrader-cli", sessionIdleMs: 1_800_000 },
      problems: [],
    });
    for (const value of ["0", "-5", "1.5", "10m", "86401"]) {
      expect(read({ CTRADER_SESSION_IDLE_SECONDS: value }).problems).toEqual([
        "CTRADER_SESSION_IDLE_SECONDS must be a whole number of seconds from 1 to 86400",
      ]);
    }
  });

  it("reports an unpinned image and an unknown mode", () => {
    expect(read({ CTRADER_IMAGE: "registry/ctrader:latest", CTRADER_CLI: "docker" }).problems).toEqual([
      "CTRADER_IMAGE must be pinned to a version or digest, not latest",
      "CTRADER_CLI must be local or container",
    ]);
  });
});
