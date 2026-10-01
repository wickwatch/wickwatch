import type { Overview } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
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
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "admin", role: "admin", totpEnabled: true },
  };
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
    algoFormats: ["algo"],
    parameterFormats: [],
    sourceUrl: "https://github.com/wickwatch/wickwatch",
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

  it("shows a lost broker connection instead of running, with the time in the alert", async () => {
    const since = "2026-09-25T11:58:00.000Z";
    const lost: Overview = {
      ...overview,
      instances: overview.instances.map((i) => ({ ...i, connectionLostSince: since })),
      alerts: [{ level: "warning", code: "instance_disconnected", subject: "alpha", params: { since } }],
    };
    const answer = fetchMock.getMockImplementation() as (input: URL) => Promise<Response>;
    fetchMock.mockImplementation((input: URL) => (input.pathname.endsWith("/overview") ? json(lost) : answer(input)));
    const wrapper = await render();
    const text = wrapper.text();
    expect(wrapper.find("tbody .pill").text()).toBe("Connection lost");
    expect(text).toContain("alpha: connection to the broker lost since");
    expect(text).not.toContain(since);
    wrapper.unmount();
  });

  it("hides start, stop, restart and the emergency stop from viewers, but offers the log", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "anna", role: "viewer", totpEnabled: false },
    };
    const wrapper = await render();
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels).not.toContain("Stop");
    expect(labels).not.toContain("Emergency stop");
    const actions = wrapper.findAll("tbody button").map((b) => b.attributes("aria-label") ?? "");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((label) => label.startsWith("Show log: "))).toBe(true);
    wrapper.unmount();
  });

  it("opens the log of a row in the larger view and closes its stream with it", async () => {
    const streams: { url: string; closed: boolean }[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        static readonly CLOSED = 2;
        readonly stream: { url: string; closed: boolean };
        constructor(url: URL) {
          this.stream = { url: String(url), closed: false };
          streams.push(this.stream);
        }
        addEventListener() {}
        close() {
          this.stream.closed = true;
        }
      },
    );
    const wrapper = await render();
    expect(streams).toEqual([]);

    await wrapper.find('button[aria-label="Show log: alpha"]').trigger("click");
    const dialog = wrapper.findAll("dialog").find((d) => d.find("h2").text() === "Live log: alpha")!;
    expect(dialog.find("input[type=search]").exists()).toBe(true);
    expect(streams).toEqual([{ url: "http://localhost/api/v1/instances/alpha/logs/stream?tail=1000", closed: false }]);

    await dialog.find('button[aria-label="Close"]').trigger("click");
    expect(streams[0]?.closed).toBe(true);
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
    const dialog = wrapper
      .findAll("dialog")
      .find((d) => d.findAll("button").some((b) => b.text() === "Stop and close everything"))!;
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
    // The row action names its instance, for screen readers and in the tooltip.
    const stop = wrapper.find('button[aria-label="Stop: alpha"]');
    expect(stop.attributes("data-tooltip")).toBe("Stop: alpha");
    await stop.trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toBe("Stop alpha failed: Service not reachable – try again later.");
    wrapper.unmount();
  });
});
