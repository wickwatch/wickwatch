import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceSpec } from "@wickwatch/core";
import { describeRuntimeAdapter } from "@wickwatch/core/testing";
import { describe, expect, it } from "vitest";
import { DockerRuntimeAdapter } from "../src";
import { tarFiles } from "../src/tar";
import { FakeDocker, fakeContainer } from "./fake-docker";

const IMAGE = "example/bot:1.2.3";
const spec = (overrides: Partial<InstanceSpec> = {}): InstanceSpec => ({
  name: "bot-new",
  image: IMAGE,
  command: ["run", "/mnt/wickwatch/bot.algo", "--symbol=GER40"],
  labels: { "wickwatch.instance": "bot-new", "wickwatch.symbol": "GER40" },
  files: [
    { path: "/mnt/wickwatch/bot.algo", content: new TextEncoder().encode("algo"), mode: 0o444 },
    { path: "/mnt/wickwatch/ctid.pwd", content: new TextEncoder().encode("secret"), mode: 0o400 },
  ],
  ...overrides,
});

function setup() {
  const docker = new FakeDocker().add(fakeContainer("compose-bot", { "wickwatch.instance": "compose-bot" }));
  return { docker, adapter: new DockerRuntimeAdapter({ client: docker, diskPath: "/", now: () => new Date(1000) }) };
}

describeRuntimeAdapter("docker (fake daemon, create)", { setup: () => setup().adapter, spec: spec() });

describe("creating instances", () => {
  it("pulls a missing image, creates a stopped, managed container and copies the files in", async () => {
    const { docker, adapter } = setup();
    const created = await adapter.create(spec());
    expect(created).toMatchObject({ ref: "bot-new", status: "stopped", image: IMAGE });
    expect(created.labels).toMatchObject({ "wickwatch.managed": "true", "wickwatch.symbol": "GER40" });
    expect(docker.pulls).toEqual([IMAGE]);
    const c = docker.containers.get("bot-new");
    expect(c?.created).toMatchObject({ restartPolicy: "on-failure", stopTimeout: 30, command: spec().command });
    expect(c?.archives.map((a) => a.path)).toEqual(["/"]);
    // The image is there now; no second pull.
    await adapter.create(spec({ name: "bot-two" }));
    expect(docker.pulls).toEqual([IMAGE]);
  });

  it("rejects unpinned images and bad names, and cleans up when copying fails", async () => {
    const { docker, adapter } = setup();
    await expect(adapter.create(spec({ image: "example/bot" }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(adapter.create(spec({ image: "example/bot:latest" }))).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(adapter.create(spec({ name: "bad name" }))).rejects.toMatchObject({ code: "invalid_input" });
    docker.failArchive = true;
    await expect(adapter.create(spec())).rejects.toMatchObject({ code: "unavailable" });
    expect(docker.containers.has("bot-new")).toBe(false);
  });

  it("replaces a running instance and starts the new one; keeps the old one if the new one fails", async () => {
    const { docker, adapter } = setup();
    await adapter.create(spec());
    await adapter.start("bot-new");
    const updated = await adapter.update("bot-new", spec({ command: ["run", "v2"] }));
    expect(updated.status).toBe("running");
    expect(docker.containers.get("bot-new")?.created?.command).toEqual(["run", "v2"]);
    expect([...docker.containers.keys()].sort()).toEqual(["bot-new", "compose-bot"]);

    docker.failArchive = true;
    await expect(adapter.update("bot-new", spec({ command: ["run", "v3"] }))).rejects.toBeDefined();
    expect(docker.containers.get("bot-new")?.created?.command).toEqual(["run", "v2"]);
    expect(docker.containers.get("bot-new")?.details.State.Status).toBe("running");
  });

  it("never replaces or removes containers it did not create", async () => {
    const { adapter } = setup();
    await expect(adapter.update("compose-bot", spec({ name: "compose-bot" }))).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(adapter.remove("compose-bot")).rejects.toMatchObject({ code: "invalid_input" });
    await adapter.create(spec());
    await expect(adapter.update("bot-new", spec({ name: "other" }))).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("tarFiles", () => {
  it("writes an archive that tar extracts with directories, content and modes", () => {
    const dir = mkdtempSync(join(tmpdir(), "ww-tar-"));
    const archive = join(dir, "files.tar");
    writeFileSync(archive, tarFiles(spec().files));
    const out = join(dir, "out");
    execFileSync("mkdir", [out]);
    execFileSync("tar", ["-xf", archive, "-C", out]);
    expect(readFileSync(join(out, "mnt/wickwatch/ctid.pwd"), "utf8")).toBe("secret");
    expect(statSync(join(out, "mnt/wickwatch/ctid.pwd")).mode & 0o777).toBe(0o400);
    expect(statSync(join(out, "mnt/wickwatch/bot.algo")).mode & 0o777).toBe(0o444);
    expect(() => tarFiles([{ path: "relative.txt", content: new Uint8Array(), mode: 0o644 }])).toThrow(/absolute/);
    expect(() => tarFiles([{ path: "/a/../b", content: new Uint8Array(), mode: 0o644 }])).toThrow(/absolute/);
  });
});
