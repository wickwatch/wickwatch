import type { ToolSpec } from "@wickwatch/core";
import { describe, expect, it } from "vitest";
import { DockerRuntimeAdapter } from "../src";
import { FakeDocker, fakeContainer, frame } from "./fake-docker";

const IMAGE = "example/cli:5.9.11";
const spec: ToolSpec = {
  image: IMAGE,
  command: ["accounts", "--pwd-file=/mnt/wickwatch/pwd"],
  files: [{ path: "/mnt/wickwatch/pwd", content: new TextEncoder().encode("secret"), mode: 0o400 }],
};

function setup() {
  const docker = new FakeDocker().add(fakeContainer("compose-bot", { "wickwatch.instance": "compose-bot" }));
  docker.images.add(IMAGE);
  return { docker, adapter: new DockerRuntimeAdapter({ client: docker, diskPath: "/" }) };
}

const toolOf = (docker: FakeDocker) => [...docker.containers.values()].find((c) => c.tool);

describe("runTool", () => {
  it("runs a throwaway container with the files, stdin and output, and reports the exit code", async () => {
    const { docker, adapter } = setup();
    const tool = await adapter.runTool(spec);
    const container = toolOf(docker);
    expect(container?.tool?.request).toEqual({
      image: IMAGE,
      command: spec.command,
      labels: { "wickwatch.tool": "true" },
    });
    expect(container?.archives.map((a) => a.path)).toEqual(["/"]);
    expect(container?.details.State.Status).toBe("running");

    container?.tool?.output.write(frame("Logged in.\n"));
    const seen: string[] = [];
    tool.onOutput((text) => seen.push(text));
    tool.write("accounts\n");
    expect(container?.tool?.stdin).toEqual(["accounts\n"]);
    container?.tool?.output.write(frame("[]\n"));
    container?.tool?.exit(0);

    expect(await tool.exit).toBe(0);
    expect(seen.join("")).toBe("Logged in.\n[]\n");
    // Removed like with AutoRemove.
    expect(toolOf(docker)).toBeUndefined();
  });

  it("never lists tools as instances", async () => {
    const { adapter } = setup();
    await adapter.runTool(spec);
    expect((await adapter.list()).map((i) => i.ref)).toEqual(["compose-bot"]);
  });

  it("kills a tool on request", async () => {
    const { adapter } = setup();
    const tool = await adapter.runTool(spec);
    tool.kill();
    expect(await tool.exit).toBe(137);
  });

  it("ends tools left over from an earlier run before the first new one", async () => {
    const { docker, adapter } = setup();
    const earlier = new DockerRuntimeAdapter({ client: docker, diskPath: "/" });
    const orphan = await earlier.runTool(spec);
    await adapter.runTool(spec);
    expect(await orphan.exit).toBe(137);
    expect([...docker.containers.values()].filter((c) => c.tool)).toHaveLength(1);
  });

  it("pulls a missing image and refuses unpinned ones", async () => {
    const { docker, adapter } = setup();
    await adapter.runTool({ ...spec, image: "example/other:1.0" });
    expect(docker.pulls).toEqual(["example/other:1.0"]);
    await expect(adapter.runTool({ ...spec, image: "example/cli:latest" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(adapter.runTool({ ...spec, image: "example/cli" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
