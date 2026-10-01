import type { LogLine } from "@wickwatch/core";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
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
});
