import type { LogLine } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogView from "../src/components/LogView.vue";
import { i18n, setLocale } from "../src/i18n";

const lines: (LogLine & { seq: number })[] = [
  { seq: 1, time: "2026-10-01T13:00:00.000Z", text: "Zeit Filter : PASS", level: "info" },
  { seq: 2, time: "2026-10-01T13:00:01.000Z", text: "Setup invalid: direction (Long)", level: "info" },
  { seq: 3, time: "2026-10-01T13:00:02.000Z", text: "Order failed (long)", level: "error" },
];

beforeEach(() => {
  setLocale("en", false);
});

const mountView = (large: boolean) =>
  mount(LogView, { props: { lines, state: "live", large }, global: { plugins: [i18n] } });
const texts = (w: ReturnType<typeof mountView>) => w.findAll(".log__text").map((t) => t.text());

describe("LogView", () => {
  it("searches only in the large view, ignoring case and taking the text literally, and marks the matches", async () => {
    expect(mountView(false).find("input[type=search]").exists()).toBe(false);

    const wrapper = mountView(true);
    await wrapper.find("input[type=search]").setValue("(long");
    expect(texts(wrapper)).toEqual(["Setup invalid: direction (Long)", "Order failed (long)"]);
    expect(wrapper.findAll("mark").map((m) => m.text())).toEqual(["(Long", "(long"]);
    expect(wrapper.find(".log__matches").text()).toBe("2 matching lines");

    // Search and filter together.
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Warnings & errors")
      ?.trigger("click");
    expect(texts(wrapper)).toEqual(["Order failed (long)"]);

    await wrapper.find("input[type=search]").setValue("");
    expect(wrapper.find("mark").exists()).toBe(false);
    expect(wrapper.find(".log__matches").exists()).toBe(false);
  });

  it("searches the whole log of a period on the server and goes back to the live lines", async () => {
    const fetchMock = vi.fn((_input: URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            lines: [{ time: "2026-09-28T08:00:00.000Z", text: "Order failed (short), kept from last week" }],
            truncated: true,
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(LogView, {
      props: { lines, state: "live", large: true, instanceRef: "alpha-ger40" },
      global: { plugins: [i18n] },
    });
    expect(wrapper.findComponent({ name: "MenuButton" }).exists()).toBe(false);
    await wrapper.find("input[type=search]").setValue("order failed");
    await wrapper.findComponent({ name: "MenuButton" }).vm.$emit("select", "7d");
    await flushPromises();
    const sent = fetchMock.mock.calls[0]?.[0];
    expect(sent?.pathname).toMatch(/instances\/alpha-ger40\/logs\/search$/);
    expect(Object.fromEntries(sent?.searchParams ?? [])).toEqual({ q: "order failed", filter: "all", period: "7d" });
    expect(texts(wrapper)).toEqual(["Order failed (short), kept from last week"]);
    expect(wrapper.find(".log__matches").text()).toBe("1 line in the whole log · Last 7 days · only the newest 1000");

    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Back to the live log")
      ?.trigger("click");
    expect(texts(wrapper)).toEqual(["Order failed (long)"]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
