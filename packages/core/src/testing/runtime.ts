import Type from "typebox";
import { beforeEach, describe, expect, it } from "vitest";
import type { InstanceSpec, RuntimeAdapter } from "../adapters";
import { HostStatus, LogLine, RuntimeInstance } from "../schemas";
import { expectAdapterError, expectSchema } from "./expect-schema";

export interface RuntimeContractOptions {
  /** Returns a fresh adapter; called before every test. */
  setup: () => RuntimeAdapter | Promise<RuntimeAdapter>;
  /** Spec for a temporary instance. Without it the create/start/stop/remove tests are skipped. */
  spec?: InstanceSpec;
}

export function describeRuntimeAdapter(name: string, options: RuntimeContractOptions): void {
  describe(`RuntimeAdapter contract: ${name}`, () => {
    let adapter: RuntimeAdapter;
    beforeEach(async () => {
      adapter = await options.setup();
    });

    it("has an id", () => {
      expect(adapter.id).toMatch(/\S/);
    });

    it("lists valid instances with unique refs", async () => {
      const instances = await adapter.list();
      expectSchema(Type.Array(RuntimeInstance), instances);
      expect(new Set(instances.map((i) => i.ref)).size).toBe(instances.length);
    });

    it("reports a consistent host status", async () => {
      const status = await adapter.hostStatus();
      expectSchema(HostStatus, status);
      expect(status.memUsed).toBeLessThanOrEqual(status.memTotal);
      expect(status.diskUsed).toBeLessThanOrEqual(status.diskTotal);
    });

    it("returns at most `tail` log lines in chronological order", async () => {
      const [first] = await adapter.list();
      if (!first) return;
      const lines: LogLine[] = [];
      for await (const line of adapter.logs(first.ref, { tail: 5 })) lines.push(line);
      expectSchema(Type.Array(LogLine), lines);
      expect(lines.length).toBeLessThanOrEqual(5);
      const times = lines.map((l) => Date.parse(l.time));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it("sends all log lines on request (downloads), in chronological order", async () => {
      const [first] = await adapter.list();
      if (!first) return;
      const lines: LogLine[] = [];
      for await (const line of adapter.logs(first.ref, { tail: "all" })) lines.push(line);
      expectSchema(Type.Array(LogLine), lines);
      const times = lines.map((l) => Date.parse(l.time));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it("ends a followed log stream when the signal aborts", async () => {
      const [first] = await adapter.list();
      if (!first) return;
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 50);
      for await (const line of adapter.logs(first.ref, { tail: 1, follow: true, signal: controller.signal })) {
        expectSchema(LogLine, line);
      }
      expect(controller.signal.aborted).toBe(true);
    });

    it("rejects unknown refs with not_found", async () => {
      await expectAdapterError(adapter.start("wickwatch-contract-does-not-exist"), "not_found");
    });

    it.skipIf(!options.spec)("creates, starts, stops, restarts and removes an instance", async () => {
      const spec = options.spec!;
      const created = await adapter.create(spec);
      expectSchema(RuntimeInstance, created);
      expect(created.labels).toMatchObject(spec.labels);

      const find = async () => (await adapter.list()).find((i) => i.ref === created.ref);
      expect(await find()).toBeDefined();

      await adapter.start(created.ref);
      expect((await find())?.status).toBe("running");
      await adapter.stop(created.ref);
      expect((await find())?.status).toBe("stopped");
      await adapter.restart(created.ref);
      expect((await find())?.status).toBe("running");

      const updated = await adapter.update(created.ref, { ...spec, command: [...spec.command, "--updated"] });
      expectSchema(RuntimeInstance, updated);

      await adapter.stop(updated.ref);
      await adapter.remove(updated.ref);
      expect((await adapter.list()).some((i) => i.ref === updated.ref)).toBe(false);
    });
  });
}
