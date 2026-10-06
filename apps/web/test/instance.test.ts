import type { InstanceDetail } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { formatDateTime } from "../src/format";
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
  closed = false;
  readyState = 1;
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  static readonly CLOSED = 2;
}

beforeEach(async () => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "admin", role: "admin", totpEnabled: false, apiTokens: 0 },
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
        // Not managed by wickwatch, like a container from a compose file.
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

/** The instance with two closed trades, the newer one (d2) first in the history. */
function stubTwoDeals() {
  const twoDeals: InstanceDetail = {
    ...detail,
    deals: [detail.deals[0]!, { ...detail.deals[0]!, id: "d2", time: "2026-09-25T10:00:00.000Z" }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) =>
      Promise.resolve(
        input.pathname.includes("/managed-instances/")
          ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
          : new Response(JSON.stringify(twoDeals), { status: 200 }),
      ),
    ),
  );
}

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
    // The account wickwatch knows links to its page.
    expect(wrapper.find('.head a[href$="/accounts/1111111"]').text()).toBe("Prop A · 1111111");
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

  it("shows a stopped container's log without reconnecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL) =>
        Promise.resolve(
          input.pathname.includes("/managed-instances/")
            ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
            : new Response(JSON.stringify({ ...detail, instance: { ...detail.instance, status: "stopped" } }), {
                status: 200,
              }),
        ),
      ),
    );
    const wrapper = await render();
    const source = FakeEventSource.last;
    source?.emit("open");
    source?.emit("log", { time: "2026-09-25T11:00:00.000Z", text: "Bot stopped" });
    // The stream ends after the last lines of a stopped container.
    source?.emit("error");
    await flushPromises();
    expect(source?.closed).toBe(true);
    expect(wrapper.find(".log__state").text()).toBe("Container stopped");
    expect(wrapper.find(".log__lines").text()).toContain("Bot stopped");
    wrapper.unmount();
  });

  it("shows risk and R of trades whose initial stop is known", async () => {
    const withRisk: InstanceDetail = {
      ...detail,
      deals: [{ ...detail.deals[0]!, risk: 31, riskPct: 0.31, r: 1.54 }],
      stats: { ...detail.stats, trades: 2, averageR: 1.54, totalR: 1.54, rTrades: 1 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL) =>
        Promise.resolve(
          input.pathname.includes("/managed-instances/")
            ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
            : new Response(JSON.stringify(withRisk), { status: 200 }),
        ),
      ),
    );
    const wrapper = await render();
    const history = wrapper.find("section[aria-labelledby=history-title]");
    expect(history.findAll("th").map((h) => h.text())).toContain("R");
    const cells = history.findAll("tbody td").map((c) => c.text());
    expect(cells).toContain("0.3%");
    expect(cells).toContain("+1.5R");
    // Only one of two trades has an R: the tiles say so.
    expect(wrapper.find(".kpis").text()).toContain("+1.54R");
    expect(wrapper.find(".kpis").text()).toContain("from 1 of 2 trades");
    wrapper.unmount();
  });

  it("offers all trades only when the instance traded before the longest range", async () => {
    const rangeButtons = (w: Awaited<ReturnType<typeof render>>) => w.findAll(".range button").map((b) => b.text());
    const plain = await render();
    expect(rangeButtons(plain)).toEqual(["7 days", "30 days", "90 days"]);
    plain.unmount();

    const fetch = vi.fn((input: URL) =>
      Promise.resolve(
        input.pathname.includes("/managed-instances/")
          ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
          : new Response(JSON.stringify({ ...detail, firstTradeAt: "2025-11-03T10:00:00.000Z" }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const wrapper = await render();
    expect(rangeButtons(wrapper)).toEqual(["7 days", "30 days", "90 days", "All"]);
    await wrapper.findAll(".range button")[3]?.trigger("click");
    await flushPromises();
    expect(String(fetch.mock.calls.at(-1)?.[0])).toMatch(/instances\/alpha\?all=true$/);
    expect(wrapper.find('.range button[aria-pressed="true"]').text()).toBe("All");
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
      expiresAt: "2026-09-26T21:00:00.000Z",
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
    // The expiry column appears because the order has one.
    expect(wrapper.text()).toContain("Expires");
    expect(wrapper.text()).toContain(formatDateTime("en", "2026-09-26T21:00:00.000Z"));
    // A row action is an icon with tooltip; it asks before cancelling.
    const cancel = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Cancel order");
    expect(cancel?.text()).toBe("");
    expect(cancel?.attributes("data-tooltip")).toBe("Cancel order");
    await cancel?.trigger("click");
    expect(wrapper.text()).toContain("Cancel order 320393475 (Stop Buy GER40 at 19,600)?");
    const confirm = wrapper.findAll("dialog").find((d) => d.text().includes("Cancel order 320393475"));
    const dialogButtons = confirm?.findAll("button") ?? [];
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

  it("shows the labels of an instance defined outside wickwatch in the configuration tab", async () => {
    await router.push({ name: "instance-config", params: { ref: "alpha" } });
    const wrapper = await render();
    expect(wrapper.find('.tabs [aria-current="page"]').text()).toBe("Configuration");
    expect(wrapper.text()).toContain("Defined outside wickwatch");
    expect(wrapper.find(".labels").text()).toContain("wickwatch.instance");
    expect(wrapper.find(".chart").exists()).toBe(false);
    // Nothing to edit: the configuration lives outside wickwatch.
    expect(wrapper.find('.head [aria-haspopup="menu"]').exists()).toBe(false);
    expect(wrapper.find(".head").text()).toContain("Stop");
    wrapper.unmount();
  });

  it("reports a failed start, stop or restart like the instance tables", async () => {
    let action: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL, init?: RequestInit) => {
        if (input.pathname.includes("/managed-instances/")) {
          return Promise.resolve(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
        }
        if (init?.method === "POST") return new Promise<Response>((resolve) => (action = resolve));
        return Promise.resolve(new Response(JSON.stringify(detail), { status: 200 }));
      }),
    );
    const wrapper = await render();
    const stop = wrapper.findAll(".head button").find((b) => b.text() === "Stop");
    await stop?.trigger("click");
    // Busy while it runs, like a row in the tables.
    expect(stop?.attributes("disabled")).toBeDefined();
    action?.(new Response(JSON.stringify({ error: "internal" }), { status: 500 }));
    await flushPromises();
    const notice = wrapper.find(".notice");
    expect(notice.text()).toBe("Stop alpha failed: Unexpected server error.");
    expect(notice.classes()).toContain("tone-negative");
    expect(stop?.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("shows a position's details in the drawer", async () => {
    const wrapper = await render();
    const details = wrapper.findAll(".table-wrap td button").find((b) => b.attributes("aria-label") === "Details");
    await details?.trigger("click");
    const drawer = wrapper.findAllComponents({ name: "AppModal" }).find((m) => m.props("open"));
    expect(drawer?.props("drawer")).toBe(true);
    expect(drawer?.props("title")).toMatch(/^Position · /);
    expect(drawer?.text()).toContain("Held for");
    // The head's controls are clear on their own: named for screen readers, no tooltip over the content.
    const head = drawer?.findAll(".modal__head button") ?? [];
    expect(head.map((b) => b.attributes("aria-label"))).toEqual(["Previous entry", "Next entry", "Close"]);
    expect(head.every((b) => b.attributes("data-tooltip") === undefined)).toBe(true);
    wrapper.unmount();
  });

  it("shows what changed on a position in the drawer", async () => {
    const changes = vi.spyOn(api, "positionChanges").mockResolvedValue([
      { at: "2026-09-25T10:07:00.000Z", field: "sl", from: 19380, to: 19412.5 },
      { at: "2026-09-25T10:20:00.000Z", field: "tp", to: 19500 },
      { at: "2026-09-25T10:30:00.000Z", field: "volume", from: 1, to: 0.5 },
    ]);
    const wrapper = await render();
    const drawer = () => wrapper.findAllComponents({ name: "AppModal" }).find((m) => m.props("open"));
    await wrapper.find(".table-wrap tbody tr").trigger("click");
    await flushPromises();
    expect(changes).toHaveBeenCalledWith("1111111", "p1");
    const rows = drawer()!
      .findAll(".changes li")
      .map((li) => li.findAll("span").map((s) => s.text()));
    expect(rows).toEqual([
      [formatDateTime("en", "2026-09-25T10:07:00.000Z"), "SL", "19,380 → 19,412.5"],
      [formatDateTime("en", "2026-09-25T10:20:00.000Z"), "TP", "– → 19,500"],
      [formatDateTime("en", "2026-09-25T10:30:00.000Z"), "Lots", "1.00 → 0.50"],
    ]);

    // An open position says so when nothing moved; a closed trade then shows no section at all.
    changes.mockResolvedValue([]);
    await drawer()!.find("dialog").trigger("keydown", { key: "Escape" });
    await wrapper.find(".table-wrap tbody tr").trigger("click");
    await flushPromises();
    expect(drawer()!.find(".changes").text()).toContain("None noticed so far.");
    changes.mockRestore();
    wrapper.unmount();
  });

  it("steps through the trades in the drawer, by arrow and by key", async () => {
    stubTwoDeals();
    const wrapper = await render();
    const history = wrapper.find("section[aria-labelledby=history-title]");
    // The newest trade is the first row.
    await history.find("tbody td button[aria-label=Details]").trigger("click");
    const drawer = () => wrapper.findAllComponents({ name: "AppModal" }).find((m) => m.props("open"))!;
    const shownId = () => drawer().findAll("dd").at(-1)?.text();
    const arrow = (label: string) => drawer().find(`.modal__head button[aria-label="${label}"]`);
    expect(shownId()).toBe("d2");
    expect(arrow("Previous entry").attributes("disabled")).toBeDefined();
    await arrow("Next entry").trigger("click");
    expect(shownId()).toBe("d1");
    expect(arrow("Next entry").attributes("disabled")).toBeDefined();
    await drawer().find("dialog").trigger("keydown", { key: "ArrowUp" });
    expect(shownId()).toBe("d2");
    wrapper.unmount();
  });

  it("opens a trade's details on a click on its row and closes them on a click elsewhere", async () => {
    stubTwoDeals();
    const wrapper = await render();
    const history = wrapper.find("section[aria-labelledby=history-title]");
    const rows = () => history.findAll("tbody tr");
    const drawer = () => wrapper.findAllComponents({ name: "AppModal" }).find((m) => m.props("open"));
    const shownId = () => drawer()?.findAll("dd").at(-1)?.text();

    await rows()[1]!.find("td").trigger("click");
    expect(shownId()).toBe("d1");
    expect(rows()[1]!.classes()).toContain("selected");
    // Another row of the table shows in the open drawer.
    await rows()[0]!.find("td").trigger("click");
    expect(shownId()).toBe("d2");
    // Inside the drawer it stays open; anywhere else on the page it closes.
    await drawer()!.find("dd").trigger("click");
    expect(drawer()).toBeDefined();
    await history.find("h2").trigger("click");
    expect(drawer()).toBeUndefined();

    await rows()[0]!.find("td").trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(drawer()).toBeUndefined();
    wrapper.unmount();
  });

  it("hides actions and closing positions from viewers", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "anna", role: "viewer", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    expect(wrapper.findAll(".head button")).toHaveLength(0);
    // Only the details, no trading actions.
    const rowButtons = wrapper.findAll(".table-wrap td button");
    expect(rowButtons.length).toBeGreaterThan(0);
    expect(rowButtons.every((b) => b.attributes("aria-label") === "Details")).toBe(true);
    expect(wrapper.text()).toContain("19,412.5");
    wrapper.unmount();
  });
});
