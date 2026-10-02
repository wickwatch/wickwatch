import type { Account, Algo, ParameterTemplate } from "@wickwatch/core";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedInstanceDetail } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import { system } from "../src/system";
import AlgosView from "../src/views/AlgosView.vue";
import InstanceFormView from "../src/views/InstanceFormView.vue";
import InstanceView from "../src/views/InstanceView.vue";
import TemplateEditView from "../src/views/TemplateEditView.vue";

const algo: Algo = {
  id: 1,
  name: "alpha",
  version: "1.5.0",
  sha256: "1".repeat(64),
  size: 1000,
  fullAccess: false,
  parameters: [
    { name: "RiskPercent", type: "double", label: "Risk %", default: 0.5, min: 0.1, max: 2 },
    { name: "EntryMode", type: "enum", default: "Breakout", options: ["Breakout", "Pullback"] },
    { name: "UseFilter", type: "bool", label: "Trend filter", default: true },
  ],
  uploadedAt: "2026-09-20T10:00:00.000Z",
};
const accounts: Account[] = [
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
const config = {
  version: 2,
  algo: { id: 1, name: "alpha", version: "1.5.0" },
  symbol: "GER40",
  period: "M5",
  parameters: { RiskPercent: 1, EntryMode: "Pullback", UseFilter: true },
  attribution: { mode: "auto" as const },
  createdAt: "2026-09-21T10:00:00.000Z",
  createdBy: "admin",
};
const detail: ManagedInstanceDetail = {
  id: 3,
  name: "alpha-ger40",
  account: { id: 7, number: "1111111", displayName: "Prop A" },
  createdAt: "2026-09-21T10:00:00.000Z",
  config,
  history: [config, { ...config, version: 1 }],
};
const template = (id: number, name: string, parameters: Record<string, unknown>): ParameterTemplate => ({
  id,
  algoName: "alpha",
  name,
  parameters,
  count: Object.keys(parameters).length,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
});
// A rejected value (no such option), one the algo does not know, and UseFilter left out.
const calm = template(5, "Calm", { RiskPercent: 0.3, EntryMode: "Turbo", Retired: 1 });
const fast = template(6, "Fast", { RiskPercent: 1.5, UseFilter: false, EntryMode: "Breakout" });
// Sets one parameter the algo knows and one it no longer does.
const lean = template(7, "Lean", { RiskPercent: 0.3, Retired: 1 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
  };
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    const path = input.pathname.replace(/^.*\/api\/v1\//, "");
    const method = init?.method ?? "GET";
    if (path.startsWith("instances/")) {
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    }
    if (method === "POST" && path === "parameter-templates") {
      const body = JSON.parse(String(init?.body)) as { name: string; parameters: Record<string, unknown> };
      return Promise.resolve(new Response(JSON.stringify(template(9, body.name, body.parameters)), { status: 201 }));
    }
    if (method === "PATCH") return Promise.resolve(new Response(JSON.stringify(calm), { status: 200 }));
    if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    if (method === "POST" && path === "algos/1/parameter-file") {
      const parsed = { values: { RiskPercent: 0.8 }, issues: [], unknown: ["Extra"], missing: [] };
      return Promise.resolve(new Response(JSON.stringify(parsed), { status: 200 }));
    }
    if (method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ ...detail, config: { ...config, version: 3 } }), { status: 201 }),
      );
    }
    const body =
      path === "algos"
        ? [algo]
        : path === "accounts"
          ? accounts
          : path === "accounts/7/symbols"
            ? ["GER40"]
            : path === "parameter-templates"
              ? [calm, fast]
              : path === "parameter-templates/7"
                ? lean
                : path.startsWith("managed-instances/")
                  ? detail
                  : [];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  system.value = undefined;
});

const sent = (method: string) =>
  fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === method)
    .map((c) => {
      const body = (c[1] as RequestInit).body;
      return {
        path: (c[0] as URL).pathname.replace(/^.*\/api\/v1\//, ""),
        body: typeof body === "string" ? (JSON.parse(body) as unknown) : body,
      };
    });

async function open(component: unknown, path: string) {
  await router.push(path);
  const wrapper = mount(component as typeof InstanceView, { global: { plugins: [i18n, router] } });
  await flushPromises();
  return wrapper;
}
const click = async (wrapper: VueWrapper, text: string) => {
  await wrapper
    .findAll("button")
    .find((b) => b.text() === text)
    ?.trigger("click");
  await flushPromises();
};

describe("applying a template on the configuration tab", () => {
  it("lists what changes, leaves out unticked values and saves the rest as a new version", async () => {
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    await click(wrapper, "Apply template…");
    const dialog = wrapper.find("dialog[open]");
    // Nothing chosen yet: no list of changes, nothing to save.
    expect(dialog.find("select").element.value).toBe("");
    expect(dialog.text()).toContain("Please choose a template…");
    expect(dialog.text()).toContain("A template sets parameter values saved for this algo.");
    expect(dialog.find("legend").exists()).toBe(false);
    expect(
      dialog
        .findAll("button")
        .find((b) => b.text() === "Save as version 3")
        ?.attributes("disabled"),
    ).toBeDefined();
    await dialog.find("select").setValue("5");
    // Calm is first: RiskPercent changes; Turbo does not fit, Retired is unknown, UseFilter is not in it.
    expect(dialog.find("legend").text()).toBe("1 value changes");
    expect(dialog.text()).toContain("Risk %");
    expect(dialog.text()).toContain("1 → 0.3");
    expect(dialog.text()).toContain("Not taken, they do not fit this algo version: EntryMode (Not an allowed option)");
    expect(dialog.text()).toContain("Not taken, the algo does not know them: Retired");
    expect(dialog.text()).toContain("Not in the template, the current value stays: Trend filter");

    await dialog.find("select").setValue("6");
    expect(wrapper.find("dialog[open] legend").text()).toBe("3 values change");
    // Keep the current entry mode.
    const boxes = wrapper.findAll("dialog[open] .change input");
    await boxes[1]?.setValue(false);
    const save = wrapper.findAll("dialog[open] button").find((b) => b.text() === "Save as version 3");
    expect(save?.attributes("disabled")).toBeUndefined();
    await wrapper.find("dialog[open] form").trigger("submit");
    await flushPromises();

    expect(sent("POST")).toEqual([
      {
        path: "managed-instances/alpha-ger40/configs",
        body: {
          algoId: 1,
          symbol: "GER40",
          period: "M5",
          parameters: { RiskPercent: 1.5, EntryMode: "Pullback", UseFilter: false },
          attribution: { mode: "auto" },
          comment: 'From template "Fast"',
          template: 6,
        },
      },
    ]);
    expect(wrapper.text()).toContain("Version 3 saved from the template.");
  });

  it("saves a version as a template, or replaces one of the same name", async () => {
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    const saveButtons = wrapper.findAll("button").filter((b) => b.text() === "Save as template…");
    expect(saveButtons).toHaveLength(2);
    await saveButtons[1]?.trigger("click");
    await wrapper.find("dialog[open] input").setValue("Weekend");
    await wrapper.find("dialog[open] form").trigger("submit");
    await flushPromises();
    expect(sent("POST")).toEqual([
      {
        path: "parameter-templates",
        body: {
          algoName: "alpha",
          name: "Weekend",
          parameters: config.parameters,
          source: { kind: "instance", instance: "alpha-ger40", version: 1 },
        },
      },
    ]);
    expect(wrapper.text()).toContain("Template Weekend saved.");

    await saveButtons[0]?.trigger("click");
    await wrapper.find("dialog[open] input").setValue("calm");
    expect(wrapper.find("dialog[open]").text()).toContain("The template Calm exists: its values are replaced.");
    await wrapper.find("dialog[open] form").trigger("submit");
    await flushPromises();
    expect(sent("PATCH")).toEqual([
      {
        path: "parameter-templates/5",
        body: { parameters: config.parameters, source: { kind: "instance", instance: "alpha-ger40", version: 2 } },
      },
    ]);
  });

  it("offers nothing to viewers", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "v", role: "viewer", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    expect(wrapper.text()).not.toContain("Apply template…");
    expect(wrapper.text()).not.toContain("Save as template…");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("parameter-templates"))).toBe(false);
  });
});

describe("loading a template in the instance form", () => {
  it("fills the values that fit, says what it left out and names the template when saving", async () => {
    const wrapper = await open(InstanceFormView, "/instances/new");
    const select = wrapper.find(".template-load select");
    await select.setValue("5");
    expect(wrapper.text()).toContain("Template Calm: 1 value changed.");
    expect(wrapper.text()).toContain("EntryMode (Not an allowed option)");
    expect(wrapper.find<HTMLInputElement>("#param-RiskPercent").element.value).toBe("0.3");

    await wrapper.find("input.mono").setValue("alpha-new");
    await wrapper.find('input[list="symbols-list"]').setValue("GER40");
    await wrapper.find('input[list="periods-list"]').setValue("M5");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const [create] = sent("POST");
    expect(create?.body).toMatchObject({
      config: { parameters: { RiskPercent: 0.3 }, comment: 'From template "Calm"', template: 5 },
    });
  });
});

describe("templates on the Algos page", () => {
  it("lists an algo's templates and deletes one only after confirmation", async () => {
    const wrapper = await open(AlgosView, "/algos");
    expect(wrapper.text()).toContain("Calm");
    expect(wrapper.text()).toContain("3 values");
    await wrapper.find('[aria-label="Delete: Calm"]').trigger("click");
    expect(sent("DELETE")).toEqual([]);
    await wrapper
      .findAllComponents({ name: "ConfirmDialog" })
      .find((d) => d.props("open") === true)
      ?.vm.$emit("confirm");
    await flushPromises();
    expect(sent("DELETE").map((d) => d.path)).toEqual(["parameter-templates/5"]);
    expect(wrapper.text()).toContain("Template Calm deleted.");
  });

  it("makes a template from a parameter file", async () => {
    system.value = {
      version: "test",
      defaultLocale: "en",
      labelPrefix: "wickwatch",
      adapters: { runtime: "demo", broker: "demo", config: "cbotset" },
      capabilities: {
        backtest: false,
        optimize: false,
        partialClose: false,
        pendingOrders: true,
        emergencyStop: true,
        parameterExport: [],
      },
      algoFormats: ["algo"],
      parameterFormats: ["cbotset"],
      sourceUrl: "https://github.com/wickwatch/wickwatch",
      mcp: true,
      apiTokensRequire2fa: false,
    };
    const wrapper = await open(AlgosView, "/algos");
    await click(wrapper, "Template from file…");
    const input = wrapper.find("dialog[open] input[type=file]");
    Object.defineProperty(input.element, "files", { value: [new File(["{}"], "calm.cbotset")], configurable: true });
    await input.trigger("change");
    await wrapper.find("dialog[open] input:not([type=file])").setValue("From file");
    await wrapper.find("dialog[open] form").trigger("submit");
    await flushPromises();
    expect(sent("POST").map((p) => p.path)).toEqual(["algos/1/parameter-file", "parameter-templates"]);
    expect(sent("POST")[1]?.body).toEqual({
      algoName: "alpha",
      name: "From file",
      parameters: { RiskPercent: 0.8 },
      source: { kind: "file", file: "calm.cbotset" },
    });
    expect(wrapper.text()).toContain("Template From file saved with 1 values.");
    expect(wrapper.text()).toContain("1 value from the file did not fit the algo and was left out.");
  });
});

describe("editing a template", () => {
  it("opens from the Algos page", async () => {
    const wrapper = await open(AlgosView, "/algos");
    await wrapper.find('[aria-label="Edit: Calm"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/algos/templates/5");
  });

  it("saves name and values; parameters it does not set stay out unless changed, unknown ones are kept", async () => {
    const wrapper = await open(TemplateEditView, "/algos/templates/7");
    expect(wrapper.text()).toContain("Edit template Lean");
    expect(wrapper.text()).toContain("Kept as they are, the newest version does not know them: Retired");
    expect((wrapper.find("#param-RiskPercent").element as HTMLInputElement).value).toBe("0.3");
    // Not in the template: shown with the default.
    expect((wrapper.find("#param-EntryMode").element as HTMLSelectElement).value).toBe("Breakout");

    await wrapper.find("input.input").setValue(" Leaner ");
    await wrapper.find("#param-RiskPercent").setValue("0.4");
    await wrapper.find("#param-UseFilter").setValue(false);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("PATCH")).toEqual([
      {
        path: "parameter-templates/7",
        body: { name: "Leaner", parameters: { Retired: 1, RiskPercent: 0.4, UseFilter: false } },
      },
    ]);
    expect(router.currentRoute.value.name).toBe("algos");
  });

  it("does not save a value that does not fit", async () => {
    const wrapper = await open(TemplateEditView, "/algos/templates/7");
    await wrapper.find("#param-RiskPercent").setValue("5");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("PATCH")).toEqual([]);
    expect(wrapper.find(".param--invalid").exists()).toBe(true);
  });
});
