import { describe, expect, it } from "vitest";
import { newerVersion, splitImage, stableVersion, stableVersions } from "../src/rules";

describe("image versions", () => {
  it("splits an image into repository and tag", () => {
    expect(splitImage("ghcr.io/example/platform:5.9.11")).toEqual({
      repository: "ghcr.io/example/platform",
      tag: "5.9.11",
    });
    expect(splitImage("registry.example:5000/platform:1.0")).toEqual({
      repository: "registry.example:5000/platform",
      tag: "1.0",
    });
    expect(splitImage("registry.example:5000/platform")).toEqual({ repository: "registry.example:5000/platform" });
    expect(splitImage("example/platform@sha256:abc")).toEqual({ repository: "example/platform" });
  });

  it("knows stable versions only", () => {
    expect(stableVersion("5.10.6")).toEqual([5, 10, 6]);
    expect(stableVersion("v0.8.7")).toEqual([0, 8, 7]);
    expect(stableVersion("5.10.5-alpha")).toBeUndefined();
    expect(stableVersion("latest")).toBeUndefined();
  });

  it("sorts by version, not as text, and leaves pre-releases out", () => {
    expect(stableVersions(["5.9.11", "5.10.0-alpha", "5.10.6", "5.9.5", "latest", "5.10.1"])).toEqual([
      "5.10.6",
      "5.10.1",
      "5.9.11",
      "5.9.5",
    ]);
  });

  it("names the newest stable version only when it is newer", () => {
    const tags = ["5.9.11", "5.10.1", "5.10.6", "6.0.1-alpha"];
    expect(newerVersion("5.9.11", tags)).toBe("5.10.6");
    expect(newerVersion("5.10.6", tags)).toBeUndefined();
    expect(newerVersion("6.0.0", tags)).toBeUndefined();
    // A pinned digest or a pre-release in use: nothing to compare with.
    expect(newerVersion("6.0.1-alpha", tags)).toBeUndefined();
    expect(newerVersion("0.8.6", ["v0.8.7", "0.8.6"])).toBe("v0.8.7");
  });
});
