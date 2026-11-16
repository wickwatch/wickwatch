import type { ManagedInstance, PlatformInfo } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlatformVersion from "../src/components/PlatformVersion.vue";
import { i18n, setLocale } from "../src/i18n";
import { session } from "../src/session";

const REPO = "registry.example/platform";
let info: PlatformInfo;
const instance = (name: string, image: string): ManagedInstance =>
  ({
    id: 1,
    name,
    account: { id: 7, number: "1111111", displayName: "Prop A" },
    createdAt: "2026-09-21T10:00:00.000Z",
    config: {} as ManagedInstance["config"],
    deployment: { status: "running", managed: true, configVersion: 1, image },
    scheduleIds: [],
    logRules: true,
  }) as ManagedInstance;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () =>
  fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method)
    .map((c) => ({
      method: (c[1] as RequestInit).method,
      path: (c[0] as URL).pathname.replace(/^.*\/api\/v1\//, ""),
      body: JSON.parse(String((c[1] as RequestInit).body)) as unknown,
    }));

beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
  };
  info = {
    platform: {
      image: `${REPO}:1.0.0`,
      repository: REPO,
      versions: ["1.1.0", "1.0.0"],
      latest: "1.1.0",
      checkedAt: "2026-11-16T09:00:00.000Z",
    },
    wickwatch: { current: "0.8.7", latest: "0.9.0" },
    updateCheck: true,
  };
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    const path = input.pathname.replace(/^.*\/api\/v1\//, "");
    if (path === "platform/image") {
      const { image } = JSON.parse(String(init?.body)) as { image: string };
      info = { ...info, platform: { ...info.platform!, image } };
      return Promise.resolve(Response.json(info));
    }
    if (path === "platform") return Promise.resolve(Response.json(info));
    if (path === "managed-instances") {
      return Promise.resolve(Response.json([instance("a", `${REPO}:1.0.0`), instance("b", `${REPO}:0.9.0`)]));
    }
    if (path === "managed-instances/update-images") {
      return Promise.resolve(Response.json({ updated: ["b"], skipped: [{ name: "a", reason: "open_position" }] }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const render = async () => {
  const wrapper = mount(PlatformVersion, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
};

describe("PlatformVersion", () => {
  it("shows the version in use, a newer one, and wickwatch's own", async () => {
    const wrapper = await render();
    expect(wrapper.text()).toContain("New instances run on version 1.0.0.");
    expect(wrapper.text()).toContain("Version 1.1.0 is available.");
    expect(wrapper.text()).toContain("wickwatch 0.8.7. Version 0.9.0 is available.");
    expect(wrapper.text()).toContain("One instance runs on another version: b (0.9.0).");
  });

  it("lets admins pick another version, of the platform's repository", async () => {
    const wrapper = await render();
    await wrapper.find("select").setValue("1.1.0");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls()).toEqual([{ method: "PUT", path: "platform/image", body: { image: `${REPO}:1.1.0` } }]);
    expect(wrapper.text()).toContain("New instances now run on version 1.1.0.");
    // Now both run on another version than new instances get.
    expect(wrapper.text()).toContain("2 instances run on another version");
  });

  it("updates all only after confirmation and says what it left alone", async () => {
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Update all to 1.0.0")
      ?.trigger("click");
    expect(calls()).toEqual([]);
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    expect(dialog.props("message")).toContain("Instances with an open position are left alone.");
    dialog.vm.$emit("confirm");
    await flushPromises();
    expect(calls()).toEqual([{ method: "POST", path: "managed-instances/update-images", body: { confirm: "all" } }]);
    expect(wrapper.text()).toContain("Updated to 1.0.0: b. a left alone: open position.");
  });

  it("offers no changes to viewers", async () => {
    session.value = { ...session.value!, user: { ...session.value!.user!, role: "viewer" } };
    const wrapper = await render();
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.findAll("button")).toHaveLength(0);
  });
});
