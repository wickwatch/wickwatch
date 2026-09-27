import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, AlgoRow, ManagedInstanceDetail } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import InstanceConfigView from "../src/views/InstanceConfigView.vue";
import InstanceFormView from "../src/views/InstanceFormView.vue";

const algo = (id: number, version: string, extra: AlgoRow["parameters"] = []): AlgoRow => ({
  id,
  name: "alpha",
  version,
  sha256: String(id).repeat(64),
  size: 1000,
  fullAccess: false,
  parameters: [
    { name: "RiskPercent", type: "double", label: "Risk %", group: "Risk", default: 0.5, min: 0.1, max: 2 },
    { name: "EntryMode", type: "enum", group: "Signal", default: "Breakout", options: ["Breakout", "Pullback"] },
    ...extra,
  ],
  uploadedAt: "2026-09-20T10:00:00.000Z",
});
const algos = [algo(2, "1.6.0", [{ name: "UseFilter", type: "bool", default: true }]), algo(1, "1.5.0")];
const accounts: AccountRow[] = [
  {
    id: 7,
    adapter: "demo",
    number: "1111111",
    broker: "Demo",
    currency: "USD",
    displayName: "Prop A",
    credentialId: 1,
    credentialLabel: "Login A",
    timezone: null,
    hasChallenge: false,
  },
];
const config = (version: number, risk: number, algoVersion = "1.5.0", algoId: number | null = 1) => ({
  version,
  algo: { id: algoId, name: "alpha", version: algoVersion },
  symbol: "GER40",
  period: "M5",
  parameters: { RiskPercent: risk, EntryMode: "Pullback" },
  attribution: { mode: "auto" as const },
  createdAt: "2026-09-21T10:00:00.000Z",
  createdBy: "admin",
});
const detail: ManagedInstanceDetail = {
  id: 3,
  name: "alpha-ger40",
  account: { id: 7, number: "1111111", displayName: "Prop A" },
  createdAt: "2026-09-21T10:00:00.000Z",
  config: config(2, 1),
  history: [{ ...config(2, 1), comment: "More risk" }, config(1, 0.5)],
};

let fetchMock: ReturnType<typeof vi.fn>;
let response: (url: URL, init?: RequestInit) => Response | undefined;
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false },
  };
  response = () => undefined;
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    const custom = response(input, init);
    if (custom) return Promise.resolve(custom);
    const path = input.pathname.replace(/^.*\/api\/v1\//, "");
    const body =
      path === "algos"
        ? algos
        : path === "accounts"
          ? accounts
          : path === "accounts/7/symbols"
            ? ["GER40", "NAS100"]
            : path.startsWith("managed-instances/")
              ? detail
              : [];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const posted = () =>
  fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === "POST")
    .map((c) => ({ url: (c[0] as URL).pathname, body: JSON.parse(String((c[1] as RequestInit).body)) as unknown }));

async function open(component: typeof InstanceFormView, path: string) {
  await router.push(path);
  const wrapper = mount(component, { global: { plugins: [i18n, router] } });
  await flushPromises();
  return wrapper;
}

describe("InstanceFormView", () => {
  it("generates fields from the metadata and creates an instance with all values", async () => {
    response = (url, init) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ ...detail, name: "alpha-new", config: config(1, 0.8) }), { status: 201 })
        : undefined;
    const wrapper = await open(InstanceFormView, "/instances/new");
    expect(wrapper.find("legend").text()).toBe("Risk");
    expect(wrapper.text()).toContain("2 symbols from the broker of this account");
    await wrapper.find("input.mono").setValue("alpha-new");
    await wrapper.find('input[list="symbols-list"]').setValue("GER40");
    await wrapper.find('input[list="periods-list"]').setValue("m5");
    await wrapper.find("#param-RiskPercent").setValue("0.8");
    expect(wrapper.find(".param--changed").text()).toContain("Changed");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(posted()[0]?.body).toEqual({
      name: "alpha-new",
      accountId: 7,
      config: {
        algoId: 2,
        symbol: "GER40",
        period: "m5",
        parameters: { RiskPercent: 0.8, EntryMode: "Breakout", UseFilter: true },
        attribution: { mode: "auto" },
      },
    });
    expect(router.currentRoute.value.fullPath).toBe("/instances/alpha-new/config?saved=1");
  });

  it("marks invalid parameters from the server", async () => {
    response = (url, init) =>
      init?.method === "POST"
        ? new Response(
            JSON.stringify({ error: "invalid_parameters", issues: [{ parameter: "RiskPercent", code: "above_max" }] }),
            { status: 400 },
          )
        : undefined;
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".param--invalid").text()).toContain("Above maximum");
    expect(wrapper.find("[role=alert]").text()).toBe("Some parameters are invalid; see the marked fields.");
  });

  it("restores an old version into the form and keeps known values when switching algo versions", async () => {
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit?version=1");
    expect((wrapper.find("#param-RiskPercent").element as HTMLInputElement).value).toBe("0.5");
    expect(
      wrapper.findAll("input").some((i) => (i.element as HTMLInputElement).value === "Restored from version 1"),
    ).toBe(true);
    // Name and account are fixed when editing.
    expect(wrapper.find("input.mono").attributes("disabled")).toBeDefined();
    // Options sit in optgroups, which setValue on the select does not reach in happy-dom.
    await wrapper
      .findAll("optgroup option")
      .find((o) => o.text().includes("1.6.0"))
      ?.setValue();
    expect((wrapper.find("#param-EntryMode").element as HTMLSelectElement).value).toBe("Pullback");
    expect((wrapper.find("#param-UseFilter").element as HTMLInputElement).checked).toBe(true);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(posted()[0]).toMatchObject({
      url: expect.stringMatching(/managed-instances\/alpha-ger40\/configs$/) as unknown,
      body: { algoId: 2, parameters: { RiskPercent: 0.5, EntryMode: "Pullback", UseFilter: true } },
    });
  });
});

describe("InstanceConfigView", () => {
  it("shows the current configuration and what changed per version", async () => {
    const wrapper = await open(InstanceConfigView, "/instances/alpha-ger40/config?saved=2");
    expect(wrapper.find("[role=status]").text()).toBe("Version 2 saved.");
    expect(wrapper.text()).toContain("Risk %");
    const items = wrapper.findAll(".history__item");
    expect(items[0]?.text()).toContain("More risk");
    expect(items[0]?.text()).toContain("RiskPercent: 0.5 → 1");
    expect(items[1]?.text()).toContain("Created");
    expect(items[1]?.find("a").attributes("href")).toContain("/instances/alpha-ger40/edit?version=1");
  });

  it("creates and starts the container only after confirmation", async () => {
    const wrapper = await open(InstanceConfigView, "/instances/alpha-ger40/config");
    expect(wrapper.text()).toContain("No container yet.");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Create and start")
      ?.trigger("click");
    const dialog = wrapper.findAllComponents({ name: "ConfirmDialog" })[0];
    expect(dialog?.props("message")).toContain("It will trade on this account.");
    expect(dialog?.props("message")).toContain("does not also run elsewhere");
    expect(posted()).toEqual([]);
    await dialog?.vm.$emit("confirm");
    await flushPromises();
    expect(posted()).toEqual([
      {
        url: expect.stringMatching(/managed-instances\/alpha-ger40\/deploy$/) as unknown,
        body: { confirm: "alpha-ger40", start: true },
      },
    ]);
  });

  it("offers to apply a newer version to the running bot as a restart", async () => {
    response = (url) =>
      url.pathname.endsWith("/managed-instances/alpha-ger40")
        ? new Response(
            JSON.stringify({ ...detail, deployment: { status: "running", managed: true, configVersion: 1 } }),
            { status: 200 },
          )
        : undefined;
    const wrapper = await open(InstanceConfigView, "/instances/alpha-ger40/config");
    expect(wrapper.text()).toContain("runs configuration version 1");
    expect(wrapper.text()).toContain("Version 2 is saved but not applied yet.");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Apply version 2 (restart)")
      ?.trigger("click");
    const dialog = wrapper.findAllComponents({ name: "ConfirmDialog" })[0];
    expect(dialog?.props("message")).toContain("Restart the running bot with configuration version 2?");
    await dialog?.vm.$emit("confirm");
    await flushPromises();
    expect(posted()[0]?.body).toEqual({ confirm: "alpha-ger40", start: false });
  });

  it("deletes only after confirmation, with the name as confirmation", async () => {
    const wrapper = await open(InstanceConfigView, "/instances/alpha-ger40/config");
    await wrapper.find(".btn--danger").trigger("click");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[1]?.vm.$emit("confirm");
    await flushPromises();
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
    expect(JSON.parse(String((del?.[1] as RequestInit).body))).toEqual({ confirm: "alpha-ger40" });
    expect(router.currentRoute.value.name).toBe("overview");
  });
});
