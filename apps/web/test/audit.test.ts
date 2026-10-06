import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditPage } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import AuditView from "../src/views/AuditView.vue";

const PAGE: AuditPage = {
  entries: [
    {
      id: 2,
      time: "2026-10-02T08:00:00.000Z",
      user: "anna",
      token: { id: 7, name: "ops-script" },
      action: "instance.stop",
      target: "alpha-ger40-a",
      details: { ok: true },
    },
    { id: 1, time: "2026-10-02T07:00:00.000Z", user: "anna", action: "instance.start", target: "alpha-ger40-a" },
  ],
  more: false,
  actions: ["instance.start", "instance.stop"],
};

beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "anna", role: "admin", totpEnabled: true, apiTokens: 0 },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(PAGE)))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AuditView", () => {
  it("names the API token an action came through, below its user", async () => {
    const wrapper = mount(AuditView, { global: { plugins: [i18n, router] }, attachTo: document.body });
    await flushPromises();
    const cells = wrapper.findAll("tbody tr").map((r) => r.findAll("td")[1]);
    expect(cells.map((c) => c?.find("span").text())).toEqual(["anna", "anna"]);
    expect(cells.map((c) => (c?.find(".via").exists() ? c.find(".via").text() : undefined))).toEqual([
      "via token ops-script",
      undefined,
    ]);
    wrapper.unmount();
  });

  it("loads 25 entries at a time and the older ones on demand", async () => {
    const urls: string[] = [];
    const older = { ...PAGE, entries: [{ ...PAGE.entries[1]!, id: 0 }] };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL) => {
        if (input.pathname.endsWith("/audit")) urls.push(input.search);
        const page = input.searchParams.has("before") ? older : { ...PAGE, more: true };
        return Promise.resolve(new Response(JSON.stringify(page)));
      }),
    );
    const wrapper = mount(AuditView, { global: { plugins: [i18n, router] }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);

    await wrapper.find("button.more").trigger("click");
    await flushPromises();
    expect(urls).toEqual(["?limit=25", "?before=1&limit=25"]);
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
    expect(wrapper.find("button.more").exists()).toBe(false);
    wrapper.unmount();
  });
});
