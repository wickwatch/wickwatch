import type { Account, Algo, AlgoSettings, ParameterTemplate } from "@wickwatch/core";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedInstanceDetail } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import AlgosView from "../src/views/AlgosView.vue";
import InstanceFormView from "../src/views/InstanceFormView.vue";
import InstanceView from "../src/views/InstanceView.vue";

// The parameter holding the account size is named per algo; a value one zero off the account's is warned about.

const algo: Algo = {
  id: 1,
  name: "alpha",
  version: "1.5.0",
  sha256: "1".repeat(64),
  size: 1000,
  fullAccess: false,
  parameters: [
    { name: "StartingCapital", type: "double", label: "Starting capital", default: 10_000 },
    { name: "RiskPercent", type: "double", label: "Risk %", default: 0.5, min: 0.1, max: 2 },
  ],
  uploadedAt: "2026-09-20T10:00:00.000Z",
};
const account: Account = {
  id: 7,
  adapter: "demo",
  number: "1111111",
  broker: "Demo",
  currency: "USD",
  displayName: "Prop A",
  credentialId: 1,
  credentialLabel: "Login A",
  timezone: null,
  hasChallenge: true,
  accountSize: { value: 10_000, basis: "challengeStart" },
};
const config = (capital: number) => ({
  version: 2,
  algo: { id: 1, name: "alpha", version: "1.5.0" },
  symbol: "GER40",
  period: "M5",
  parameters: { StartingCapital: capital, RiskPercent: 0.5 },
  attribution: { mode: "auto" as const },
  createdAt: "2026-09-21T10:00:00.000Z",
  createdBy: "admin",
});
const detailWith = (capital: number): ManagedInstanceDetail => ({
  id: 3,
  name: "alpha-ger40",
  account: { id: 7, number: "1111111", displayName: "Prop A" },
  createdAt: "2026-09-21T10:00:00.000Z",
  config: config(capital),
  history: [config(capital)],
  accountSizeCheck: { parameter: "StartingCapital", reference: { value: 10_000, basis: "challengeStart" } },
});
const tooLarge: ParameterTemplate = {
  id: 5,
  algoName: "alpha",
  name: "Backtest",
  parameters: { StartingCapital: 100_000 },
  count: 1,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
};

let settings: AlgoSettings[];
let accounts: Account[];
let detail: ManagedInstanceDetail;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
  };
  settings = [{ algoName: "alpha", accountSizeParameter: "StartingCapital" }];
  accounts = [account];
  detail = detailWith(100_000);
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    const path = input.pathname.replace(/^.*\/api\/v1\//, "");
    const method = init?.method ?? "GET";
    if (path.startsWith("instances/")) {
      return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    }
    if (method === "PUT") return Promise.resolve(new Response(init?.body as string, { status: 200 }));
    if (method === "POST") return Promise.resolve(new Response(JSON.stringify(detail), { status: 201 }));
    const body =
      path === "algos"
        ? [algo]
        : path === "algo-settings"
          ? settings
          : path === "accounts"
            ? accounts
            : path === "parameter-templates"
              ? [tooLarge]
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

const sent = (method: string) =>
  fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === method)
    .map((c) => ({
      path: (c[0] as URL).pathname.replace(/^.*\/api\/v1\//, ""),
      body: JSON.parse(String((c[1] as RequestInit).body)) as unknown,
    }));

async function open(component: unknown, path: string) {
  await router.push(path);
  const wrapper = mount(component as typeof InstanceView, { global: { plugins: [i18n, router] } });
  await flushPromises();
  return wrapper;
}
const openDialog = (wrapper: VueWrapper) =>
  wrapper.findAllComponents({ name: "ConfirmDialog" }).find((d) => d.props("open") === true);

const WARNING =
  "Starting capital is 100,000.00; the account's challenge start balance: 10,000.00. Positions calculated from it would be about 10 times too large.";

describe("account size check", () => {
  it("warns at the field and saves a far-off account size only after confirmation", async () => {
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    expect(wrapper.find(".param__warning").text()).toBe(WARNING);

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("POST")).toEqual([]);
    expect(openDialog(wrapper)?.props("message")).toBe(WARNING);

    await openDialog(wrapper)?.vm.$emit("confirm");
    await flushPromises();
    expect(sent("POST").map((p) => p.path)).toEqual(["managed-instances/alpha-ger40/configs"]);
  });

  it("saves a fitting value without asking, and checks against the day-start balance without a challenge", async () => {
    accounts = [{ ...account, hasChallenge: false, accountSize: { value: 9800, basis: "dayStart" } }];
    detail = detailWith(10_000);
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    expect(wrapper.find(".param__warning").exists()).toBe(false);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("POST")).toHaveLength(1);

    await wrapper.find("#param-StartingCapital").setValue("100000");
    expect(wrapper.find(".param__warning").text()).toContain(
      "the account's balance at the start of the trading day: 9,800.00",
    );
  });

  it("checks nothing for an algo without the setting", async () => {
    settings = [];
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    expect(wrapper.find(".param__warning").exists()).toBe(false);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("POST")).toHaveLength(1);
  });

  it("shows a banner on the configuration tab of an instance saved with it", async () => {
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    expect(wrapper.text()).toContain(WARNING);
    // The size comes with the instance: no overview, which would query the broker for every account.
    const paths = fetchMock.mock.calls.map((c) => (c[0] as URL).pathname);
    expect(paths.some((path) => path.endsWith("/overview") || path.endsWith("/algo-settings"))).toBe(false);
  });

  it("warns before a template sets it", async () => {
    detail = detailWith(10_000);
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    expect(wrapper.text()).not.toContain("times too large");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Apply template…")
      ?.trigger("click");
    await flushPromises();
    await wrapper.find("dialog[open] select").setValue("5");
    await flushPromises();
    expect(wrapper.find("dialog[open]").text()).toContain(WARNING);
  });

  it("is set per algo on the Algos page, by admins, together with the risk parameter", async () => {
    settings = [];
    const wrapper = await open(AlgosView, "/algos");
    const [size, risk] = wrapper.findAll(".size__form select");
    expect(size?.findAll("option").map((o) => o.text())).toEqual(["None", "Starting capital", "Risk %"]);
    await size?.setValue("StartingCapital");
    await risk?.setValue("RiskPercent");
    await wrapper.find(".size__form").trigger("submit");
    await flushPromises();
    expect(sent("PUT")).toEqual([
      { path: "algo-settings/alpha", body: { accountSizeParameter: "StartingCapital", riskParameter: "RiskPercent" } },
    ]);
    expect(wrapper.text()).toContain("Account size and risk parameters of alpha saved.");
  });

  it("shows viewers the setting without a form", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "v", role: "viewer", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await open(AlgosView, "/algos");
    // Folded by default; the summary says what is set.
    expect(wrapper.find("details.size").attributes("open")).toBeUndefined();
    expect(wrapper.find(".size__summary").text()).toBe(
      "Account size and risk · Account size: Starting capital · Risk: None",
    );
    expect(wrapper.findAll("select")).toHaveLength(0);
  });
});

describe("risk preview", () => {
  beforeEach(() => {
    settings = [{ algoName: "alpha", accountSizeParameter: "StartingCapital", riskParameter: "RiskPercent" }];
    accounts = [{ ...account, lossLimits: { daily: 500, max: 1000 } }];
  });

  it("shows the risk per trade in money against the loss limits in the form", async () => {
    detail = detailWith(10_000);
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    expect(wrapper.find(".banner").text()).toBe(
      "Risk per tradeRisk per trade: about 50.00 USD (0.5% of 10,000.00 from Starting capital).10% of the daily loss limit (500.00 USD) · 5% of the max loss (1,000.00 USD)",
    );
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("POST")).toHaveLength(1);
  });

  it("asks before saving a risk that one losing trade uses up a limit with", async () => {
    // The incident it is for: a backtest's starting capital ten times the account's.
    const wrapper = await open(InstanceFormView, "/instances/alpha-ger40/edit");
    expect(wrapper.find(".banner--negative").text()).toContain(
      "100% of the daily loss limit (500.00 USD) · 50% of the max loss (1,000.00 USD)One losing trade would use up a loss limit of the challenge.",
    );
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(sent("POST")).toEqual([]);
    expect(openDialog(wrapper)?.props("title")).toBe("Save with this risk?");
    expect(openDialog(wrapper)?.props("message")).toBe(
      `${WARNING} One losing trade would use up a loss limit of the challenge.`,
    );
  });

  it("shows the saved version's risk on the configuration tab", async () => {
    detail = {
      ...detailWith(10_000),
      riskCheck: {
        parameter: "RiskPercent",
        currency: "USD",
        sizeParameter: "StartingCapital",
        reference: { value: 10_000, basis: "challengeStart" },
        limits: { daily: 500 },
      },
    };
    const wrapper = await open(InstanceView, "/instances/alpha-ger40/config");
    expect(wrapper.text()).toContain("Risk per trade: about 50.00 USD (0.5% of 10,000.00 from Starting capital).");
    expect(wrapper.text()).toContain("10% of the daily loss limit (500.00 USD)");
  });
});
