import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionList from "../src/components/SessionList.vue";
import { i18n, setLocale } from "../src/i18n";

const phone = {
  id: "a1",
  createdAt: "2026-10-01T08:00:00Z",
  lastSeenAt: "2026-10-04T08:00:00Z",
  expiresAt: "2026-10-31T08:00:00Z",
  remember: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1",
  current: false,
};
const laptop = {
  id: "b2",
  createdAt: "2026-10-04T07:00:00Z",
  lastSeenAt: "2026-10-04T08:00:00Z",
  expiresAt: "2026-10-04T20:00:00Z",
  remember: false,
  current: true,
};

let sessions: object[];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  sessions = [laptop, phone];
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      sessions = sessions.filter((s) => "current" in s && s.current);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(JSON.stringify(sessions)));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionList", () => {
  it("lists the sessions with their device, and offers to log out all but this one", async () => {
    const wrapper = mount(SessionList, { global: { plugins: [i18n] } });
    await flushPromises();
    const rows = wrapper.findAll(".session");
    expect(rows.map((r) => r.find(".session__device").text())).toEqual(["Unknown device", "Safari · iOS"]);
    expect(rows[0]?.find(".pill").text()).toBe("This session");
    expect(rows[0]?.find("button").exists()).toBe(false);
    expect(rows[1]?.text()).toContain("stay logged in");

    await rows[1]?.find("button").trigger("click");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url.pathname).toMatch(/auth\/sessions\/a1$/);
    expect(wrapper.findAll(".session")).toHaveLength(1);
    expect(wrapper.find(".status").text()).toBe("Session logged out.");
    const endOthers = wrapper.findAll("button").find((b) => b.text() === "Log out all others");
    expect(endOthers?.attributes("disabled")).toBeDefined();
  });
});
