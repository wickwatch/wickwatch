import { describeRuntimeAdapter } from "@wickwatch/core/testing";
import type { LogLine } from "@wickwatch/core";
import { describe, expect, it } from "vitest";
import { connectionOptions, DockerRuntimeAdapter, toStatus } from "../src";
import { demux, splitLines, toLogLine } from "../src/logs";
import { FakeDocker, fakeContainer, frame } from "./fake-docker";

const labels = (name: string) => ({ "wickwatch.instance": name, "wickwatch.symbol": "GER40" });

function setup() {
  const docker = new FakeDocker()
    .add(fakeContainer("bot-b", labels("bot-b")))
    .add(fakeContainer("bot-a", labels("bot-a"), { Status: "exited", ExitCode: 1 }))
    .add(fakeContainer("socket-proxy", { "com.example.other": "x" }));
  return { docker, adapter: new DockerRuntimeAdapter({ client: docker, diskPath: "/" }) };
}

async function collect(lines: AsyncIterable<LogLine>): Promise<LogLine[]> {
  const out: LogLine[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

describeRuntimeAdapter("docker (fake daemon)", { setup: () => setup().adapter });

describe("DockerRuntimeAdapter", () => {
  it("lists only labelled containers, sorted, with status and start time", async () => {
    const instances = await setup().adapter.list();
    expect(instances.map((i) => [i.ref, i.status])).toEqual([
      ["bot-a", "error"],
      ["bot-b", "running"],
    ]);
    expect(instances[1]).toMatchObject({ startedAt: "2026-09-25T08:00:00.123Z", image: "example/bot:1.0" });
  });

  it("never acts on containers without the instance label", async () => {
    const { adapter, docker } = setup();
    await expect(adapter.stop("socket-proxy")).rejects.toMatchObject({ code: "not_found" });
    expect(docker.containers.get("socket-proxy")?.details.State.Status).toBe("running");
  });

  it("uses the configured label prefix", async () => {
    const docker = new FakeDocker().add(fakeContainer("x", { "acme.instance": "x" }));
    expect(await new DockerRuntimeAdapter({ client: docker, labelPrefix: "acme" }).list()).toHaveLength(1);
    expect(await new DockerRuntimeAdapter({ client: docker }).list()).toHaveLength(0);
  });

  it("stops, starts and restarts; a repeated start or stop is fine", async () => {
    const { adapter } = setup();
    const status = async () => (await adapter.list()).find((i) => i.ref === "bot-b")?.status;
    await adapter.stop("bot-b");
    await adapter.stop("bot-b");
    expect(await status()).toBe("stopped");
    await adapter.start("bot-b");
    await adapter.start("bot-b");
    expect(await status()).toBe("running");
    await adapter.restart("bot-b");
    expect((await adapter.list()).find((i) => i.ref === "bot-b")?.restartCount).toBe(1);
  });

  it("does not remove containers defined elsewhere (e.g. compose)", async () => {
    const { adapter, docker } = setup();
    await expect(adapter.remove("bot-b")).rejects.toMatchObject({ code: "invalid_input" });
    expect(docker.containers.has("bot-b")).toBe(true);
  });

  it("reads timestamped, multiplexed logs and guesses the level", async () => {
    const { adapter, docker } = setup();
    const lines = await collect(adapter.logs("bot-b", { tail: 5, since: "2026-09-25T11:00:00.000Z" }));
    expect(lines).toEqual([
      { time: "2026-09-25T11:59:00.000Z", text: "Started", level: "info" },
      { time: "2026-09-25T11:59:30.000Z", text: "Login failed: bad password", level: "error" },
    ]);
    expect(docker.containers.get("bot-b")?.logRequests[0]).toEqual({
      tail: 5,
      follow: false,
      since: Date.parse("2026-09-25T11:00:00.000Z") / 1000,
    });
  });

  it("follows logs until the signal aborts and closes the stream", async () => {
    const { adapter, docker } = setup();
    const controller = new AbortController();
    const seen: string[] = [];
    const done = (async () => {
      for await (const line of adapter.logs("bot-b", { tail: 1, follow: true, signal: controller.signal })) {
        seen.push(line.text);
        if (seen.length === 2) controller.abort();
      }
    })();
    await new Promise((r) => setTimeout(r, 10));
    docker.containers.get("bot-b")?.streams[0]?.write(frame("2026-09-25T12:00:00Z Signal confirmed\n"));
    await done;
    expect(seen).toEqual(["Login failed: bad password", "Signal confirmed"]);
    expect(docker.containers.get("bot-b")?.streams[0]?.destroyed).toBe(true);
  });

  it("closes a follow stream when the signal aborted while the logs request was on its way", async () => {
    const { adapter, docker } = setup();
    const controller = new AbortController();
    const container = docker.container.bind(docker);
    docker.container = (name) => {
      const handle = container(name);
      return { ...handle, logs: (request) => (controller.abort(), handle.logs(request)) };
    };
    const seen: string[] = [];
    for await (const line of adapter.logs("bot-b", { follow: true, signal: controller.signal })) seen.push(line.text);
    expect(seen).toEqual([]);
    expect(docker.containers.get("bot-b")?.streams[0]?.destroyed).toBe(true);
  });

  it("maps connection problems to unavailable", async () => {
    const broken = new DockerRuntimeAdapter({
      client: {
        listByLabel: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
        container: () => {
          throw new Error("unused");
        },
        hasImage: () => Promise.resolve(true),
        pull: () => Promise.resolve(),
        create: () => Promise.resolve("unused"),
        createTool: () => Promise.resolve("unused"),
      },
    });
    await expect(broken.list()).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("hostStatus", () => {
  it("falls back to an existing parent when the data directory does not exist yet", async () => {
    const adapter = new DockerRuntimeAdapter({ client: new FakeDocker(), diskPath: "/does/not/exist/yet" });
    const status = await adapter.hostStatus();
    expect(status.diskTotal).toBeGreaterThan(0);
    expect(status.diskUsed).toBeLessThanOrEqual(status.diskTotal);
    expect(status.ntpSynced).toBeUndefined();
  });
});

describe("helpers", () => {
  it.each([
    [{ Status: "running" }, "running"],
    [{ Status: "running", Health: { Status: "unhealthy" } }, "error"],
    [{ Status: "exited", ExitCode: 0 }, "stopped"],
    [{ Status: "exited", ExitCode: 143 }, "stopped"],
    [{ Status: "exited", ExitCode: 137 }, "stopped"],
    [{ Status: "exited", ExitCode: 137, OOMKilled: true }, "error"],
    [{ Status: "exited", ExitCode: 1 }, "error"],
    [{ Status: "restarting", Restarting: true }, "restarting"],
    [{ Status: "created" }, "stopped"],
    [{ Status: "dead" }, "error"],
    [{ Status: "removing" }, "unknown"],
  ])("maps %j to %s", (state, expected) => {
    expect(toStatus({ ExitCode: 0, StartedAt: "", Restarting: false, ...state })).toBe(expected);
  });

  it("parses DOCKER_HOST", () => {
    expect(connectionOptions("tcp://socket-proxy:2375")).toEqual({
      protocol: "http",
      host: "socket-proxy",
      port: 2375,
    });
    expect(connectionOptions("unix:///var/run/docker.sock")).toEqual({ socketPath: "/var/run/docker.sock" });
    expect(connectionOptions(undefined)).toEqual({});
  });

  it("demuxes frames split across chunks and splits lines", async () => {
    const data = Buffer.concat([frame("a\nb"), frame("c\n")]);
    async function* chunks() {
      yield data.subarray(0, 5);
      yield data.subarray(5, 13);
      yield data.subarray(13);
    }
    const lines: string[] = [];
    for await (const line of splitLines(demux(chunks()))) lines.push(line);
    expect(lines).toEqual(["a", "bc"]);
  });

  it("keeps lines without a timestamp and parses WW-SETUP", () => {
    const now = () => new Date("2026-09-25T12:00:00.000Z");
    expect(toLogLine("no stamp here", now)).toMatchObject({ time: "2026-09-25T12:00:00.000Z", text: "no stamp here" });
    expect(toLogLine('2026-09-25T12:00:00Z WW-SETUP {"signal":"long"}', now).setup).toEqual({ signal: "long" });
  });
});
