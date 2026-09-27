import type { Overview } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { system } from "../src/system";
import OverviewView from "../src/views/OverviewView.vue";

const overview: Overview = {
  time: "2026-09-25T12:00:00.000Z",
  accounts: [
    {
      number: "1111111",
      displayName: "Prop A",
      currency: "USD",
      credentialLabel: "Login A",
      state: "running",
      balance: 104180.2,
      equity: 104390.6,
      dayPnl: 320.4,
      openPositions: 1,
      instances: { total: 2, running: 2 },
    },
    {
      number: "2222222",
      displayName: "Prop B",
      state: "error",
      error: "auth_failed",
      openPositions: 0,
      instances: { total: 0, running: 0 },
    },
  ],
  instances: [
    {
      ref: "alpha",
      name: "alpha",
      account: "1111111",
      symbol: "GER40",
      period: "M5",
      status: "running",
      startedAt: "2026-09-22T08:00:00.000Z",
      restartCount: 0,
      openPositions: 1,
      dayPnl: -412.8,
      lastLog: { time: "2026-09-25T11:59:00.000Z", text: "Waiting for signal", level: "info" },
    },
  ],
  alerts: [{ level: "error", code: "account_error", subject: "2222222", params: { reason: "auth_failed" } }],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setLocale("en", false);
  system.value = {
    version: "test",
    defaultLocale: "en",
    labelPrefix: "wickwatch",
    adapters: { runtime: "demo", broker: "demo", config: "demo" },
    capabilities: {
      backtest: false,
      optimize: false,
      partialClose: false,
      pendingOrders: true,
      emergencyStop: true,
      parameterExport: [],
    },
  };
  fetchMock = vi.fn((input: URL) => {
    const path = input.pathname;
    if (path.endsWith("/overview")) return json(overview);
    if (path.endsWith("/emergency-stop"))
      return json({ stoppedInstances: ["alpha"], failedInstances: [], closed: 1, cancelled: 0 });
    if (path.endsWith("/instances/alpha/stop")) return json({ error: "unavailable" }, 503);
    return json({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function render() {
  const wrapper = mount(OverviewView, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("OverviewView", () => {
  it("shows accounts, instances and alerts with text and signs, not colour alone", async () => {
    const wrapper = await render();
    const text = wrapper.text();
    expect(text).toContain("Prop A");
    expect(text).toContain("104,180.20");
    expect(text).toContain("+320.40");
    expect(text).toContain("−412.80");
    expect(text).toContain("Running");
    expect(text).toContain("Not reachable");
    expect(text).toContain("Account 2222222 not reachable: Login failed – check the credentials.");
    expect(text).toContain("2 of 2 instances active");
    wrapper.unmount();
  });

  it("renders German when the locale changes", async () => {
    setLocale("de", false);
    const wrapper = await render();
    expect(wrapper.text()).toContain("104.180,20");
    expect(wrapper.text()).toContain("Läuft");
    expect(wrapper.text()).toContain("Notstopp");
    wrapper.unmount();
  });

  it("asks for confirmation before the emergency stop and sends the account number", async () => {
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Emergency stop")!
      .trigger("click");
    const dialog = wrapper.find("dialog");
    expect(dialog.text()).toContain("Stop all instances on account Prop A · 1111111");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("emergency-stop"))).toBe(false);

    await dialog
      .findAll("button")
      .find((b) => b.text() === "Stop and close everything")!
      .trigger("click");
    await flushPromises();

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("emergency-stop"));
    expect(String(call?.[0])).toBe("http://localhost/api/v1/accounts/1111111/emergency-stop");
    expect(call?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ confirm: "1111111" }) });
    expect(wrapper.find('[role="status"]').text()).toBe(
      "Emergency stop 1111111: 1 instances stopped, 1 positions closed, 0 orders cancelled.",
    );
    wrapper.unmount();
  });

  it("reports a failed instance action with the translated reason", async () => {
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Stop")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toBe("Stop alpha failed: Service not reachable – try again later.");
    wrapper.unmount();
  });
});
