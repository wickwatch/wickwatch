// Runs against a real Docker daemon: WICKWATCH_DOCKER_TEST=1 pnpm --filter @wickwatch/adapter-docker test
// Creates throw-away alpine containers with their own label prefix and removes them afterwards.
import Docker from "dockerode";
import { describeRuntimeAdapter } from "@wickwatch/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectionOptions, DockerRuntimeAdapter } from "../src";

const enabled = process.env["WICKWATCH_DOCKER_TEST"] === "1";
const PREFIX = "wickwatch-it";
const NAME = `wickwatch-it-${process.pid}`;
const IMAGE = "alpine:3.20";

describe.skipIf(!enabled)("DockerRuntimeAdapter against a real daemon", () => {
  const docker = new Docker(connectionOptions(process.env["DOCKER_HOST"]));
  const dockerHost = process.env["DOCKER_HOST"];
  const adapter = () => new DockerRuntimeAdapter({ labelPrefix: PREFIX, ...(dockerHost ? { dockerHost } : {}) });

  beforeAll(async () => {
    const stream = await docker.pull(IMAGE);
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => {
        if (error) reject(error);
        else resolve(undefined);
      });
    });
    const container = await docker.createContainer({
      name: NAME,
      Image: IMAGE,
      Cmd: ["sh", "-c", 'i=0; trap "exit 0" TERM; while true; do echo "tick $i"; i=$((i+1)); sleep 0.2; done'],
      Labels: { [`${PREFIX}.instance`]: NAME, [`${PREFIX}.symbol`]: "GER40" },
    });
    await container.start();
    await new Promise((r) => setTimeout(r, 800));
  }, 120_000);

  afterAll(async () => {
    await docker.getContainer(NAME).remove({ force: true });
  });

  const managedSpec = (name: string, marker: string) => ({
    name,
    image: IMAGE,
    command: ["sh", "-c", 'trap "exit 0" TERM; cat /mnt/wickwatch/marker.txt; while true; do sleep 0.2; done'],
    labels: { [`${PREFIX}.instance`]: name },
    files: [{ path: "/mnt/wickwatch/marker.txt", content: new TextEncoder().encode(marker), mode: 0o400 }],
  });

  describeRuntimeAdapter("docker (real daemon)", { setup: adapter, spec: managedSpec(`${NAME}-contract`, "contract") });

  it("creates a managed container with its files, replaces and removes it", async () => {
    const runtime = adapter();
    const name = `${NAME}-managed`;
    const firstLine = async () => {
      await new Promise((r) => setTimeout(r, 800));
      for await (const line of runtime.logs(name, { tail: 5 })) return line.text;
      return undefined;
    };
    try {
      expect((await runtime.create(managedSpec(name, "first"))).status).toBe("stopped");
      await runtime.start(name);
      expect(await firstLine()).toBe("first");
      const updated = await runtime.update(name, managedSpec(name, "second"));
      expect(updated.status).toBe("running");
      expect(await firstLine()).toBe("second");
      await runtime.remove(name);
      expect((await runtime.list()).some((i) => i.ref === name)).toBe(false);
    } finally {
      await docker
        .getContainer(name)
        .remove({ force: true })
        .catch(() => undefined);
    }
  }, 60_000);

  it("finds the container, follows its logs and stops and starts it", async () => {
    const runtime = adapter();
    expect((await runtime.list()).map((i) => [i.ref, i.status])).toEqual([[NAME, "running"]]);

    const lines: string[] = [];
    for await (const line of runtime.logs(NAME, { tail: 3 })) lines.push(line.text);
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.startsWith("tick "))).toBe(true);

    await runtime.stop(NAME);
    expect((await runtime.list())[0]?.status).toBe("stopped");
    await runtime.start(NAME);
    expect((await runtime.list())[0]?.status).toBe("running");
  }, 60_000);
});
