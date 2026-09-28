import type { InstanceDetail } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import InstanceView from "../src/views/InstanceView.vue";

const detail: InstanceDetail = {
  time: "2026-09-25T12:00:00.000Z",
  instance: {
    ref: "alpha",
    name: "alpha",
    account: "1111111",
    symbol: "GER40",
    period: "M5",
    status: "running",
    startedAt: "2026-09-22T08:00:00.000Z",
    restartCount: 0,
    openPositions: 1,
    dayPnl: 12,
    labels: { "wickwatch.instance": "alpha" },
    image: "bot:1",
  },
  account: { number: "1111111", displayName: "Prop A", currency: "USD" },
  positions: [
    {
      id: "p1",
      symbol: "GER40",
      side: "buy",
      volume: 1,
      entry: 19412.5,
      pnl: 210.4,
      label: "alpha",
      openedAt: "2026-09-25T09:16:04.000Z",
    },
  ],
  pendingOrders: [],
  deals: [
    {
      id: "d1",
      positionId: "x",
      symbol: "GER40",
      side: "sell",
      volume: 1,
      price: 19400,
      pnl: 432.5,
      commission: -3,
      label: "alpha",
      time: "2026-09-24T09:21:00.000Z",
    },
  ],
  excludedPositions: [],
  excludedDeals: [],
  stats: { trades: 1, wins: 1, losses: 0, winRate: 1, averageWin: 429.5, grossProfit: 429.5, grossLoss: 0, net: 429.5 },
  range: { from: "2026-08-26T12:00:00.000Z", to: "2026-09-25T12:00:00.000Z" },
};

class FakeEventSource {
  static last: FakeEventSource | undefined;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  constructor(readonly url: string | URL) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, fn);
  }
  emit(type: string, data?: object) {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data ?? {}) }));
  }
  close() {}
}

beforeEach(async () => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "admin", role: "admin", totpEnabled: false },
  };
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) =>
      Promise.resolve(
        // Not managed by Wickwatch, like a container from a compose file.
        input.pathname.includes("/managed-instances/")
          ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
          : new Response(JSON.stringify(detail), { status: 200 }),
      ),
    ),
  );
  await router.push({ name: "instance", params: { ref: "alpha" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function render() {
  const wrapper = mount(InstanceView, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("InstanceView", () => {
  it("shows key figures, positions, the chart and live log lines", async () => {
    const wrapper = await render();
    const text = wrapper.text();
    expect(text).toContain("alpha");
    expect(text).toContain("Prop A · 1111111 · GER40 · M5 · bot:1");
    expect(text).toContain("100%");
    expect(text).toContain("+429.50");
    expect(text).toContain("19,412.5");
    expect(wrapper.find(".chart svg").exists()).toBe(true);
    expect(String(FakeEventSource.last?.url)).toContain("api/v1/instances/alpha/logs/stream");

    FakeEventSource.last?.emit("open");
    FakeEventSource.last?.emit("log", { time: "2026-09-25T11:00:00.000Z", text: "Login failed", level: "error" });
    await flushPromises();
    expect(wrapper.find(".log__line--error").text()).toContain("Login failed");
    expect(wrapper.find(".log__state").text()).toBe("Live");
    wrapper.unmount();
  });

  it("cancels a pending order after confirmation", async () => {
    const order = {
      id: "320393475",
      symbol: "GER40",
      type: "stop" as const,
      side: "buy" as const,
      volume: 1,
      price: 19600,
    };
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL, init?: RequestInit) => {
        calls.push({ url: input.pathname, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (input.pathname.includes("/managed-instances/")) {
          return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
        }
        if (init?.method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(new Response(JSON.stringify({ ...detail, pendingOrders: [order] }), { status: 200 }));
      }),
    );
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Cancel order")
      ?.trigger("click");
    expect(wrapper.text()).toContain("Cancel order 320393475 (Stop Buy GER40 at 19,600)?");
    const dialogButtons = wrapper.findAll("dialog")[1]?.findAll("button") ?? [];
    // Button, dialog title and confirmation say the same.
    expect(dialogButtons.map((b) => b.text())).toEqual(["Cancel", "Cancel order"]);
    await dialogButtons[1]?.trigger("click");
    await flushPromises();
    expect(calls.find((c) => c.url.endsWith("/cancel"))).toEqual({
      url: expect.stringMatching(/accounts\/1111111\/orders\/320393475\/cancel$/) as unknown,
      body: { confirm: "320393475" },
    });
    expect(wrapper.find(".notice").text()).toBe("Order 320393475 cancelled.");
    wrapper.unmount();
  });

  it("hides actions and closing positions from viewers", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "anna", role: "viewer", totpEnabled: false },
    };
    const wrapper = await render();
    expect(wrapper.findAll(".head button")).toHaveLength(0);
    expect(wrapper.findAll(".table-wrap button")).toHaveLength(0);
    expect(wrapper.text()).toContain("19,412.5");
    wrapper.unmount();
  });
});
