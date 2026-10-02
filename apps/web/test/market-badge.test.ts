import type { MarketHours } from "@wickwatch/core";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InstanceTable from "../src/components/InstanceTable.vue";
import MarketBadge from "../src/components/MarketBadge.vue";
import { i18n, setLocale } from "../src/i18n";

// Local times are checked for one zone; the test machine's own must not matter.
vi.stubEnv("TZ", "Europe/Berlin");

const HOUR = 3600;
const DAY = 24 * HOUR;
// US30.cash at FTMO: Sun 22:05 – Mon 20:50 UTC and so on to Friday, i.e. Mon–Fri 00:05–22:50 in Berlin summer time.
const us30: MarketHours = {
  alwaysOpen: false,
  sessions: [0, 1, 2, 3, 4].map((d) => ({ start: d * DAY + 22 * HOUR + 300, end: (d + 1) * DAY + 20 * HOUR + 3000 })),
};
const render = (hours: MarketHours, iso: string) =>
  mount(MarketBadge, { props: { hours, now: Date.parse(iso) }, global: { plugins: [i18n] } });
const detail = (wrapper: ReturnType<typeof render>) => wrapper.find(".visually-hidden").text();

beforeEach(() => {
  setLocale("en", false);
});

describe("MarketBadge", () => {
  it("says the market is open, with the weekly hours in local time and when it closes", () => {
    // Friday 21:27 in Berlin.
    const wrapper = render(us30, "2026-10-02T19:27:00Z");
    expect(wrapper.find(".pill").text()).toBe("Market open");
    expect(wrapper.find(".pill").classes()).toContain("tone-positive");
    expect(detail(wrapper).split("\n")).toEqual([
      "Trading hours (local time)",
      "Mon–Fri 12:05 AM–10:50 PM",
      "Closes Fri 10:50 PM",
      "By the broker's weekly schedule, without holidays.",
    ]);
  });

  it("uses the 24-hour clock and German day names in German", () => {
    setLocale("de", false);
    const wrapper = render(us30, "2026-10-02T19:27:00Z");
    expect(wrapper.find(".pill").text()).toBe("Markt offen");
    expect(detail(wrapper)).toContain("Mo–Fr 00:05–22:50");
    expect(detail(wrapper)).toContain("Schließt Fr 22:50");
  });

  it("warns in the last half hour", () => {
    const wrapper = render(us30, "2026-10-02T20:30:00Z");
    expect(wrapper.find(".pill").text()).toBe("Market closing soon");
    expect(wrapper.find(".pill").classes()).toContain("tone-warning");
    expect(detail(wrapper)).toContain("Closes in 20 min");
  });

  it("says when a closed market opens, also over the weekend", () => {
    const wrapper = render(us30, "2026-10-03T12:00:00Z");
    expect(wrapper.find(".pill").text()).toBe("Market closed");
    expect(detail(wrapper)).toContain("Opens Mon 12:05 AM");
  });

  it("shows hours over midnight as the trading week and its daily break", () => {
    // EURUSD: Sun 23:05 – Mon 22:55 in Berlin summer time, and so on to Friday.
    const eurusd: MarketHours = {
      alwaysOpen: false,
      sessions: [0, 1, 2, 3, 4].map((d) => ({
        start: d * DAY + 21 * HOUR + 300,
        end: (d + 1) * DAY + 20 * HOUR + 3300,
      })),
    };
    expect(detail(render(eurusd, "2026-10-01T12:00:00Z")).split("\n").slice(1, 3)).toEqual([
      "Sun 11:05 PM – Fri 10:55 PM",
      "Daily break 10:55 PM–11:05 PM",
    ]);
  });

  it("pins its tooltip on a click, as touch has no hover, and describes the badge for screen readers", () => {
    const wrapper = render({ alwaysOpen: true, sessions: [] }, "2026-10-03T12:00:00Z");
    const button = wrapper.find("button");
    expect(button.text()).toBe("Market open");
    expect(button.attributes("data-tooltip")).toBe("Open around the clock, by the broker's schedule.");
    expect(button.attributes()).toHaveProperty("data-tooltip-pin");
    expect(wrapper.find(`#${String(button.attributes("aria-describedby"))}`).text()).toBe(
      "Open around the clock, by the broker's schedule.",
    );
  });
});

describe("in the instance table", () => {
  it("has a column of its own, short under its head, and only where the hours are known", () => {
    const base = {
      status: "running" as const,
      restartCount: 0,
      openPositions: 0,
      dayPnl: 0,
      account: "1",
      symbol: "US30",
    };
    const wrapper = mount(InstanceTable, {
      props: {
        instances: [
          { ...base, ref: "a", name: "a", marketHours: us30 },
          { ...base, ref: "b", name: "b" },
        ],
        accountNames: new Map(),
        busy: new Map(),
        now: Date.parse("2026-10-03T12:00:00Z"),
        canAct: false,
      },
      global: { plugins: [i18n], stubs: { RouterLink: true } },
    });
    expect(wrapper.findAll("thead th").map((th) => th.text())).toContain("Market");
    const cells = wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((td) => td.text()));
    const market = wrapper.findAll("thead th").findIndex((th) => th.text() === "Market") - 1;
    expect(cells[0]?.[market]).toMatch(/^Closed/);
    expect(cells[1]?.[market]).toBe("–");
  });
});
