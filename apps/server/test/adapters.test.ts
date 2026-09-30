import { describe, expect, it } from "vitest";
import { createAdapters } from "../src/adapters";
import { loadConfig } from "../src/config";
import { ConfigError } from "../src/config-error";

const config = (env: Record<string, string>) => loadConfig({ DATABASE_URL: "file::memory:", ...env });

function problems(env: Record<string, string>): string[] {
  try {
    createAdapters(config(env));
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

describe("createAdapters", () => {
  it("runs the cTrader CLI locally by default or in the official image through the docker runtime", () => {
    expect(createAdapters(config({ BROKER_ADAPTER: "ctrader-cli" })).broker.id).toBe("ctrader-cli");
    expect(
      createAdapters(config({ BROKER_ADAPTER: "ctrader-cli", CTRADER_CLI: "container", RUNTIME_ADAPTER: "docker" }))
        .broker.id,
    ).toBe("ctrader-cli");
  });

  it("refuses CTRADER_CLI=container without a runtime that runs tools", () => {
    expect(problems({ BROKER_ADAPTER: "ctrader-cli", CTRADER_CLI: "container" })).toEqual([
      expect.stringContaining("RUNTIME_ADAPTER=docker"),
    ]);
  });

  it("names unknown adapters", () => {
    expect(problems({ RUNTIME_ADAPTER: "podman" })).toEqual([expect.stringContaining('RUNTIME_ADAPTER "podman"')]);
  });
});
