import { describe, expect, it } from "vitest";
import { validateParameters, type LogLine } from "@wickwatch/core";
import { createDemoAdapters, demoAlgoPath } from "../src";

const now = () => new Date("2026-09-25T12:00:00.000Z");
const c = { login: "demo", secret: "demo" };

async function snapshot(seed: number) {
  const { runtime, broker } = createDemoAdapters({ seed, now });
  return {
    instances: await runtime.list(),
    stats: await broker.stats(c, "1111111"),
    positions: await broker.positions(c, "1111111"),
    deals: await broker.deals(c, "1111111", "2026-09-18T00:00:00.000Z", "2026-09-25T12:00:00.000Z"),
  };
}

async function collect(lines: AsyncIterable<LogLine>): Promise<LogLine[]> {
  const result: LogLine[] = [];
  for await (const line of lines) result.push(line);
  return result;
}

describe("demo adapter", () => {
  it("produces the same data for the same seed and clock", async () => {
    expect(await snapshot(1)).toEqual(await snapshot(1));
    expect((await snapshot(2)).deals).not.toEqual((await snapshot(1)).deals);
  });

  it("provides four instances, one of them in error", async () => {
    const instances = await createDemoAdapters({ now }).runtime.list();
    expect(instances.map((i) => [i.ref, i.status])).toEqual([
      ["alpha-ger40-a", "running"],
      ["beta-nas100-a", "running"],
      ["alpha-us30-b", "running"],
      ["beta-us500-own", "error"],
    ]);
    expect(instances[0]?.labels).toMatchObject({ "wickwatch.instance": "alpha-ger40-a", "wickwatch.symbol": "GER40" });
  });

  it("uses the configured label prefix", async () => {
    const [first] = await createDemoAdapters({ now, labelPrefix: "acme" }).runtime.list();
    expect(Object.keys(first!.labels).every((key) => key.startsWith("acme."))).toBe(true);
  });

  it("labels positions and deals with the instance name", async () => {
    const { broker } = createDemoAdapters({ now });
    const [position] = await broker.positions(c, "1111111");
    expect(position?.label).toBe("alpha-ger40-a");
    const { deals } = await snapshot(1);
    expect(deals.length).toBeGreaterThan(0);
    expect(new Set(deals.map((d) => d.label))).toEqual(new Set(["alpha-ger40-a", "beta-nas100-a"]));
  });

  it("parses setup lines and reports login failures in logs", async () => {
    const { runtime } = createDemoAdapters({ now });
    const lines = await collect(runtime.logs("alpha-ger40-a", { tail: 200 }));
    expect(lines).toHaveLength(200);
    expect(lines.some((l) => l.setup?.["label"] === "alpha-ger40-a")).toBe(true);

    const failing = await collect(runtime.logs("beta-us500-own", { tail: 10 }));
    expect(failing.some((l) => l.level === "error" && l.text.includes("Login failed"))).toBe(true);
  });

  it("emergency stop closes positions and cancels orders of one account only", async () => {
    const { broker } = createDemoAdapters({ now });
    expect(await broker.emergencyStop(c, "1111111")).toEqual({ closed: 1, cancelled: 1 });
    expect(await broker.positions(c, "1111111")).toEqual([]);
    expect(await broker.pendingOrders(c, "1111111")).toEqual([]);
    expect(await broker.positions(c, "2222222")).toHaveLength(1);
  });

  it("ships parameter sets that match the algo metadata", async () => {
    const { broker, config, runtime } = createDemoAdapters({ now });
    for (const instance of await runtime.list()) {
      const ref = instance.labels["wickwatch.instance"]!;
      const algo = ref.startsWith("alpha") ? "alpha" : "beta";
      const version = instance.labels["wickwatch.algo-version"]!;
      const { parameters } = await broker.algoMetadata(demoAlgoPath(algo, version));
      const values = await config.read(`sets/${ref}.json`);
      expect(validateParameters(values, parameters)).toEqual({ errors: [], unknown: [], missing: [] });
    }
  });

  it("refuses to remove a running instance", async () => {
    const { runtime } = createDemoAdapters({ now });
    await expect(runtime.remove("alpha-ger40-a")).rejects.toMatchObject({ code: "invalid_input" });
  });
});
