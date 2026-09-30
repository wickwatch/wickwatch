import type { Account, Algo, SystemInfo } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedInstanceDetail } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import { system } from "../src/system";
import InstanceFormView from "../src/views/InstanceFormView.vue";
import InstanceView from "../src/views/InstanceView.vue";

const algo = (id: number, version: string, extra: Algo["parameters"] = []): Algo => ({
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
    // No container: the runtime does not know the instance.
    if (path.startsWith("instances/")) {
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    }
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
    .map((c) => {
      const body = (c[1] as RequestInit).body;
      return { url: (c[0] as URL).pathname, body: typeof body === "string" ? (JSON.parse(body) as unknown) : body };
    });

async function open(component: typeof InstanceFormView | typeof InstanceView, path: string) {
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
    // Grouped by the algo's parameter groups.
    expect(wrapper.findAll(".group__title").map((g) => g.text())).toEqual(["Risk", "Signal", "General"]);
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

  it("shows every attribution mode with its meaning and asks for the pattern where needed", async () => {
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    const modes = wrapper.findAll(".mode");
    expect(modes).toHaveLength(4);
    expect(modes[2]?.text()).toContain("Order label pattern");
    expect(wrapper.find(".mode__label").exists()).toBe(false);
    await wrapper.find('input[type="radio"][value="label-pattern"]').setValue(true);
    expect(wrapper.find(".mode--chosen").text()).toContain("Order label pattern");
    await wrapper.find(".mode__label input").setValue("^alpha-\\d+$");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(posted()[0]?.body).toMatchObject({ attribution: { mode: "label-pattern", orderLabel: "^alpha-\\d+$" } });
  });

  it("turns the name into lower case with hyphens and marks what cannot be fixed", async () => {
    const wrapper = await open(InstanceFormView, "/instances/new");
    const name = wrapper.find("input.mono");
    await name.setValue("Probe Demo_1");
    expect((name.element as HTMLInputElement).value).toBe("probe-demo-1");
    expect(wrapper.find(".field__error").exists()).toBe(false);

    await name.setValue("probe.dämo");
    expect(name.attributes("aria-invalid")).toBe("true");
    expect(wrapper.find(".field__error").text()).toBe("Not allowed here: . ä");

    // A hyphen at the end could still become valid while typing: shown when leaving the field.
    await name.setValue("probe-");
    expect(wrapper.find(".field__error").exists()).toBe(false);
    await name.trigger("blur");
    expect(wrapper.find(".field__error").text()).toContain("starts and ends with a letter or digit");
  });

  it("does not send a form with problems and marks every field", async () => {
    const wrapper = await open(InstanceFormView, "/instances/new");
    await wrapper.find('input[list="symbols-list"]').setValue("DAX");
    await wrapper.find("#param-RiskPercent").setValue("5");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(posted()).toEqual([]);
    expect(wrapper.findAll(".field__error").map((e) => e.text())).toEqual([
      "Required.",
      "This account does not offer this symbol.",
      "Required.",
    ]);
    expect(wrapper.find(".param--invalid").text()).toContain("Above maximum");
  });

  it("puts a field the server rejected onto that field", async () => {
    response = (url, init) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: "invalid_input", message: 'body/name must match pattern "…"' }), {
            status: 400,
          })
        : undefined;
    const wrapper = await open(InstanceFormView, "/instances/new");
    await wrapper.find("input.mono").setValue("alpha-new");
    await wrapper.find('input[list="symbols-list"]').setValue("ger40");
    await wrapper.find('input[list="periods-list"]').setValue("M5");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    // The broker's spelling is sent.
    expect(posted()[0]?.body).toMatchObject({ config: { symbol: "GER40" } });
    expect(wrapper.find("input.mono").attributes("aria-invalid")).toBe("true");
    expect(wrapper.find(".field__error").text()).toBe("The server did not accept this value.");
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
  });

  it("loads parameters from a file into the form and tells what it did not take", async () => {
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
    };
    response = (url, init) =>
      init?.method === "POST" && url.pathname.endsWith("/parameter-file")
        ? new Response(
            JSON.stringify({
              values: { RiskPercent: 1.2 },
              symbol: "nas100",
              period: "m15",
              issues: [{ parameter: "EntryMode", code: "invalid_option" }],
              unknown: ["LicenseKey"],
              missing: [],
            }),
            { status: 200 },
          )
        : undefined;
    try {
      const wrapper = await open(InstanceFormView, "/instances/new");
      const input = wrapper.find('input[type="file"][accept=".cbotset"]');
      Object.defineProperty(input.element, "files", { value: [new File(["{}"], "us30_m30.cbotset")] });
      await input.trigger("change");
      await flushPromises();
      expect((wrapper.find("#param-RiskPercent").element as HTMLInputElement).value).toBe("1.2");
      // The broker's spelling of the symbol.
      expect((wrapper.find('input[list="symbols-list"]').element as HTMLInputElement).value).toBe("NAS100");
      expect(wrapper.find(".file-load [role=status]").text()).toContain("1 values from us30_m30.cbotset applied.");
      const lines = wrapper.findAll(".file-load [role=status] p");
      expect(lines[0]?.classes()).toContain("tone-positive");
      // Rejected values are a warning, in full and with the reason, not part of the green success line.
      expect(lines[1]?.text()).toBe("Not applied, they break the algo's rules: EntryMode (Not an allowed option)");
      expect(lines[1]?.classes()).toContain("tone-warning");
      expect(lines[2]?.text()).toContain("ignored: LicenseKey");
      expect(posted()).toEqual([
        expect.objectContaining({ url: expect.stringMatching(/algos\/2\/parameter-file$/) as unknown }),
      ]);
    } finally {
      system.value = undefined;
    }
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
    // Version 1 differs from the current version 2 in one value; the save bar counts it.
    expect(wrapper.find(".savebar__count").text()).toBe("1 unsaved change");
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

describe("InstanceView configuration tab", () => {
  it("shows the current configuration and what changed per version", async () => {
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config?saved=2");
    expect(wrapper.find("[role=status]").text()).toBe("Version 2 saved.");
    expect(wrapper.text()).toContain("Risk %");
    const items = wrapper.findAll(".history__item");
    expect(items[0]?.text()).toContain("More risk");
    expect(items[0]?.text()).toContain("RiskPercent: 0.5 → 1");
    expect(items[1]?.text()).toContain("Created");
    expect(items[1]?.find("a").attributes("href")).toContain("/instances/alpha-ger40/edit?version=1");
  });

  it("shows a configuration without a container, with edit but no start", async () => {
    const wrapper = await open(InstanceView, "/instances/alpha-ger40");
    expect(wrapper.find(".head .pill").text()).toBe("No container");
    expect(wrapper.find(".head").text()).toContain("Prop A · 1111111 · GER40 · M5");
    expect(wrapper.text()).toContain("No container yet, so there are no trades and no log.");
    const head = wrapper.find(".head__actions");
    expect(head.find("a").attributes("href")).toContain("/instances/alpha-ger40/edit");
    expect(head.text()).not.toContain("Start");
  });

  it("creates and starts the container only after confirmation", async () => {
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
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

  it("reports the result of a deployment, or why it failed", async () => {
    let fail = false;
    response = (url, init) =>
      init?.method === "POST" && url.pathname.endsWith("/deploy")
        ? fail
          ? new Response(JSON.stringify({ error: "internal" }), { status: 500 })
          : new Response(JSON.stringify({ status: "stopped", configVersion: 2 }), { status: 200 })
        : undefined;
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    const create = async () => {
      await wrapper
        .findAll("button")
        .find((b) => b.text() === "Create")
        ?.trigger("click");
      await wrapper.findAllComponents({ name: "ConfirmDialog" })[0]?.vm.$emit("confirm");
      await flushPromises();
    };
    await create();
    expect(wrapper.find(".tab [role=status]").text()).toBe("Configuration version 2 applied; status: Stopped.");
    fail = true;
    await create();
    expect(wrapper.find(".tab [role=alert]").text()).toBe("Unexpected server error.");
    expect(wrapper.find(".tab [role=status]").exists()).toBe(false);
  });

  describe("with a runtime that needs every text value", () => {
    const runtime: SystemInfo = {
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
        requiresTextValues: true,
        parameterExport: [],
      },
      algoFormats: ["algo"],
      parameterFormats: ["cbotset"],
      sourceUrl: "https://github.com/wickwatch/wickwatch",
    };
    const withLicence = [
      {
        ...algo(1, "1.5.0"),
        parameters: [...algo(1, "1.5.0").parameters, { name: "Licence", type: "string" as const }],
      },
    ];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    /** The runtime and an algo with a text parameter the saved versions leave empty; `managed` as the server sends it. */
    const serve = (managed: ManagedInstanceDetail) => {
      response = (url) =>
        url.pathname.endsWith("/api/v1/system")
          ? json(runtime)
          : url.pathname.endsWith("/api/v1/algos")
            ? json(withLicence)
            : url.pathname.endsWith("/managed-instances/alpha-ger40")
              ? json(managed)
              : undefined;
    };
    beforeEach(() => {
      system.value = runtime;
    });
    afterEach(() => {
      system.value = undefined;
    });

    it("warns admins about an empty text value and blocks the deployment", async () => {
      serve(detail);
      const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
      expect(wrapper.find(".banner").text()).toContain("Version 2 cannot start");
      expect(wrapper.find(".banner").text()).toContain("Licence");
      const create = wrapper.findAll("button").find((b) => b.text() === "Create and start");
      expect(create?.attributes("disabled")).toBeDefined();
    });

    it("shows viewers neither the warning nor empty values: they get no parameter values", async () => {
      session.value = {
        setupRequired: false,
        masterKeyConfigured: true,
        user: { username: "v", role: "viewer", totpEnabled: false },
      };
      const hide = (c: ManagedInstanceDetail["config"]) => ({ ...c, parameters: {} });
      serve({ ...detail, config: hide(detail.config), history: detail.history.map(hide) });
      const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
      expect(wrapper.text()).not.toContain("cannot start");
      expect(wrapper.find(".params").exists()).toBe(false);
      expect(wrapper.text()).toContain("Only admins see the parameter values; they may hold licence keys.");
      expect(wrapper.find(".facts").text()).toContain("GER40");
    });
  });

  it("offers to apply a newer version to the running bot as a restart", async () => {
    response = (url) =>
      url.pathname.endsWith("/managed-instances/alpha-ger40")
        ? new Response(
            JSON.stringify({ ...detail, deployment: { status: "running", managed: true, configVersion: 1 } }),
            { status: 200 },
          )
        : undefined;
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    expect(wrapper.find(".head").text()).toContain("Configuration v1");
    expect(wrapper.find(".banner").text()).toContain("Version 2 is saved, the container still uses version 1.");
    // Start and stop live in the page head only.
    expect(wrapper.find(".banner").text()).not.toContain("Stop");
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
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    await wrapper.find('.head [aria-haspopup="menu"]').trigger("click");
    await wrapper
      .findAll('[role="menuitem"]')
      .find((b) => b.text() === "Delete")
      ?.trigger("click");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    await wrapper.findAllComponents({ name: "ConfirmDialog" })[1]?.vm.$emit("confirm");
    await flushPromises();
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
    expect(JSON.parse(String((del?.[1] as RequestInit).body))).toEqual({ confirm: "alpha-ger40" });
    expect(router.currentRoute.value.name).toBe("overview");
  });
});
