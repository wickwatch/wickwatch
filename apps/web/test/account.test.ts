import type { AccountDeals, AccountDetail } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import { system } from "../src/system";
import AccountView from "../src/views/AccountView.vue";

const detail = (over: Partial<AccountDetail["account"]> = {}): AccountDetail => ({
  time: "2026-09-30T12:00:00.000Z",
  account: {
    number: "1111111",
    displayName: "Prop A",
    currency: "USD",
    state: "stopped",
    balance: 100_000,
    equity: 100_120,
    dayPnl: 120,
    openPositions: 2,
    pendingOrders: 1,
    instances: { total: 1, running: 0 },
    ...over,
  },
  instances: [
    {
      ref: "alpha",
      name: "alpha",
      account: "1111111",
      status: "stopped",
      restartCount: 0,
      openPositions: 1,
      dayPnl: 0,
    },
  ],
  positions: [
    {
      id: "p1",
      symbol: "GER40",
      side: "buy",
      volume: 1,
      entry: 19400,
      pnl: 100,
      openedAt: "2026-09-30T09:00:00Z",
      instance: "alpha",
    },
    { id: "p2", symbol: "GER40", side: "sell", volume: 1, entry: 19500, pnl: 20, openedAt: "2026-09-30T10:00:00Z" },
  ],
  pendingOrders: [{ id: "o1", symbol: "GER40", type: "limit", side: "sell", volume: 1, price: 19600 }],
  alerts: [],
});

const deals = (): AccountDeals => ({
  range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-30T12:00:00.000Z" },
  deals: [
    {
      id: "d1",
      positionId: "p8",
      symbol: "GER40",
      side: "sell",
      volume: 1,
      price: 19450,
      pnl: 50,
      time: "2026-09-29T09:00:00Z",
      instance: "alpha",
    },
    {
      id: "d2",
      positionId: "p9",
      symbol: "GER40",
      side: "sell",
      volume: 1,
      price: 19470,
      pnl: 70,
      time: "2026-09-30T08:00:00Z",
    },
  ],
});

let body: AccountDetail;
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
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
    mcp: true,
    apiTokensRequire2fa: false,
    newsCalendar: false,
  };
  body = detail();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.pathname.endsWith("/detail")
              ? body
              : input.pathname.endsWith("/deals")
                ? deals()
                : input.pathname.endsWith("/system")
                  ? system.value
                  : [],
          ),
          { status: 200 },
        ),
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  system.value = undefined;
});

async function open(path = "/accounts/1111111") {
  await router.push(path);
  const wrapper = mount(AccountView, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("AccountView", () => {
  it("lists all positions and orders of the account with the instance each belongs to", async () => {
    const wrapper = await open();
    expect(wrapper.find("h1").text()).toBe("Prop A");
    const rows = wrapper.findAll("section[aria-labelledby=positions-title] tbody tr");
    expect(rows.map((r) => r.find("td").text())).toEqual(["alpha", "No instance"]);
    expect(rows[0]?.find("a").attributes("href")).toContain("/instances/alpha");
    expect(wrapper.find("section[aria-labelledby=orders-title] tbody td").text()).toBe("No instance");
    wrapper.unmount();
  });

  it("offers the emergency stop only when there is something to stop", async () => {
    const withPositions = await open();
    // Bots stopped, but positions are open: the stop still closes them.
    expect(withPositions.find(".head .btn--danger").text()).toBe("Emergency stop");
    withPositions.unmount();

    body = { ...detail({ openPositions: 0, pendingOrders: 0 }), positions: [], pendingOrders: [] };
    const empty = await open();
    expect(empty.find(".head .btn--danger").exists()).toBe(false);
    empty.unmount();
  });

  it("opens the challenge profile in a modal, also from the old editor address", async () => {
    const wrapper = await open("/accounts/1111111/challenge");
    expect(router.currentRoute.value.name).toBe("account");
    const shown = wrapper.findAllComponents({ name: "AppModal" }).filter((m) => m.props("open"));
    // The challenge modal only, no trade details drawer.
    expect(shown.map((m) => m.props("drawer"))).toEqual([false]);
    expect(wrapper.findComponent({ name: "ChallengeForm" }).exists()).toBe(true);
    wrapper.unmount();
  });

  it("lists the closed trades, also those of no instance, and assigns one to an instance", async () => {
    const wrapper = await open();
    const history = wrapper.find("section[aria-labelledby=history-title]");
    // Newest first.
    expect(history.findAll("tbody tr").map((r) => r.find("td").text())).toEqual(["No instance", "alpha"]);

    await history.find("tbody tr button[aria-label='Assign instance']").trigger("click");
    const dialog = wrapper.findComponent({ name: "AttributionDialog" });
    expect(dialog.props("trade")).toMatchObject({ positionId: "p9", symbol: "GER40" });
    const select = dialog.find("select");
    expect(select.findAll("option").map((o) => o.text())).toEqual([
      "Automatic (the rules decide)",
      "No instance",
      "alpha",
    ]);
    // Nothing chosen yet: the rules decide, as before.
    expect(dialog.find("button[type=submit]").attributes("disabled")).toBeDefined();
    await select.setValue("=alpha");
    await dialog.find("form").trigger("submit");
    await flushPromises();

    const fetch = vi.mocked(globalThis.fetch);
    const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(String(put?.[0])).toMatch(/accounts\/1111111\/positions\/p9\/attribution$/);
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ instance: "alpha" });
    expect(wrapper.find(".notice").text()).toBe("Position p9 now counts for alpha.");
    expect(dialog.props("open")).toBe(false);
    // The trades are asked again, not on every poll.
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/deals"))).toHaveLength(2);
    wrapper.unmount();
  });

  it("offers no attribution to viewers", async () => {
    session.value = { ...session.value!, user: { ...session.value!.user!, role: "viewer" } };
    const wrapper = await open();
    expect(wrapper.find("section[aria-labelledby=history-title] tbody tr").exists()).toBe(true);
    expect(wrapper.find("button[aria-label='Assign instance']").exists()).toBe(false);
    wrapper.unmount();
  });
});
