import type { ParameterSchema } from "@wickwatch/core";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ParameterField from "../src/components/ParameterField.vue";
import ParameterList from "../src/components/ParameterList.vue";
import { i18n, setLocale } from "../src/i18n";

const schema: ParameterSchema[] = [
  { name: "RiskPercent", type: "double", label: "Risk %", group: "Risk", default: 0.5, min: 0.1, max: 2 },
  { name: "StopLoss", type: "int", group: "Risk", default: 40 },
  { name: "EntryMode", type: "enum", group: "Signal", default: "Breakout", options: ["Breakout", "Pullback"] },
];

beforeEach(() => {
  setLocale("en", false);
});

const mountList = (props: {
  mode: "view" | "edit" | "schema";
  values?: Record<string, unknown>;
  schema?: ParameterSchema[];
  missing?: ReadonlySet<string>;
}) => mount(ParameterList, { props: { schema, ...props }, global: { plugins: [i18n] }, attachTo: document.body });
const open = (w: ReturnType<typeof mountList>) =>
  w.findAll(".group__toggle").map((b) => [b.find(".group__title").text(), b.attributes("aria-expanded")]);

describe("ParameterList", () => {
  it("starts with every group closed and counts parameters and changes per group", () => {
    const wrapper = mountList({ mode: "view", values: { RiskPercent: 1, StopLoss: 40, EntryMode: "Breakout" } });
    expect(open(wrapper)).toEqual([
      ["Risk", "false"],
      ["Signal", "false"],
    ]);
    const risk = wrapper.findAll(".group__toggle")[0];
    expect(risk?.text()).toContain("2 parameters");
    expect(risk?.text()).toContain("1 changed");
    // The changed value is marked with text; its default is in the tooltip.
    const marker = wrapper.find(".row .pill");
    expect(marker.text()).toContain("Changed");
    expect(marker.attributes("data-tooltip")).toBe("Default 0.5");
    wrapper.unmount();
  });

  it("opens the groups with matches while searching or filtering", async () => {
    const wrapper = mountList({ mode: "view", values: { RiskPercent: 1, StopLoss: 40, EntryMode: "Breakout" } });
    await wrapper.find("input[type=search]").setValue("entry");
    expect(open(wrapper)).toEqual([["Signal", "true"]]);
    await wrapper.find("input[type=search]").setValue("");
    await wrapper
      .findAll("button")
      .find((b) => b.text().startsWith("Only changed"))
      ?.trigger("click");
    expect(open(wrapper)).toEqual([["Risk", "true"]]);
    expect(wrapper.findAll(".row").map((r) => r.find(".row__name").text())).toEqual(["Risk %RiskPercent"]);
    wrapper.unmount();
  });

  it("resets all values to their defaults only after confirmation", async () => {
    const wrapper = mountList({ mode: "edit", values: { RiskPercent: 1, StopLoss: 60, EntryMode: "Breakout" } });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Reset all to default")
      ?.trigger("click");
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    expect(dialog.props("message")).toContain("Reset all 2 changed parameters");
    expect(wrapper.emitted("update:values")).toBeUndefined();
    await dialog.vm.$emit("confirm");
    expect(wrapper.emitted("update:values")?.at(-1)).toEqual([
      { RiskPercent: 0.5, StopLoss: 40, EntryMode: "Breakout" },
    ]);
    wrapper.unmount();
  });

  it("filters the required values still missing and keeps a field while it is being filled in", async () => {
    const wrapper = mountList({ mode: "edit", values: { RiskPercent: 0.5, StopLoss: 40, EntryMode: "Breakout" } });
    const missingButton = () => wrapper.findAll("button").find((b) => b.text().startsWith("Only missing"));
    const fields = () => wrapper.findAllComponents(ParameterField).map((f) => f.props("param").name);
    // Nothing missing: no button.
    expect(missingButton()).toBeUndefined();

    await wrapper.setProps({ missing: new Set(["StopLoss", "EntryMode"]) });
    expect(missingButton()?.text()).toBe("Only missing 2");
    await missingButton()?.trigger("click");
    expect(missingButton()?.attributes("aria-pressed")).toBe("true");
    expect(fields()).toEqual(["StopLoss", "EntryMode"]);

    // Filled in: the count goes down, the field stays until the filter is switched off.
    await wrapper.setProps({ missing: new Set<string>() });
    expect(missingButton()?.text()).toBe("Only missing");
    expect(fields()).toEqual(["StopLoss", "EntryMode"]);
    await missingButton()?.trigger("click");
    expect(missingButton()).toBeUndefined();
    expect(fields()).toEqual(["RiskPercent", "StopLoss", "EntryMode"]);
    wrapper.unmount();
  });

  it("opens a group with a problem and names it in the header", async () => {
    const wrapper = mountList({ mode: "edit", values: { RiskPercent: 5, StopLoss: 40, EntryMode: "Breakout" } });
    await wrapper.setProps({ issues: new Map([["RiskPercent", "above_max"]]) });
    expect(open(wrapper)[0]).toEqual(["Risk", "true"]);
    expect(wrapper.findAll(".group__toggle")[0]?.text()).toContain("1 error");
    wrapper.unmount();
  });

  it("lists an algo without groups flat, with type, default and range", () => {
    const flat = schema.map(({ group: _group, ...p }) => p);
    const wrapper = mountList({ mode: "schema", schema: flat });
    expect(wrapper.find(".group__toggle").exists()).toBe(false);
    expect(wrapper.text()).toContain("RiskPercent · double");
    expect(wrapper.text()).toContain("0.1 … 2");
    expect(wrapper.text()).toContain("Breakout | Pullback");
    // No values, so nothing to filter by "changed".
    expect(wrapper.text()).not.toContain("Only changed");
    wrapper.unmount();
  });

  it("puts a description written into the label behind an info button", async () => {
    const described: ParameterSchema[] = [
      {
        name: "ExcludeLongStr",
        type: "string",
        label: "Ausschlusszeiten Long - Eine oder mehrere Zeiten [hh:mm-hh:mm], kommasepariert.",
        default: "",
      },
    ];
    const wrapper = mountList({ mode: "view", schema: described, values: { ExcludeLongStr: "" } });
    expect(wrapper.find(".name__title").text()).toBe("Ausschlusszeiten Long");
    // An empty value reads as empty, not as missing.
    expect(wrapper.find(".row__value").text()).toBe("–");
    const info = wrapper.find(".name__info");
    expect(info.attributes("aria-label")).toBe("Description of Ausschlusszeiten Long");
    expect(info.attributes("data-tooltip")).toContain("Eine oder mehrere Zeiten");
    expect(wrapper.find(".name__description").isVisible()).toBe(false);
    await info.trigger("click");
    expect(info.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".name__description").isVisible()).toBe(true);
    wrapper.unmount();
  });

  it("shows values the algo does not know in a group of their own", () => {
    const wrapper = mountList({ mode: "view", values: { RiskPercent: 0.5, LicenseKey: "abc" } });
    expect(open(wrapper).map(([title]) => title)).toContain("Not in the algo");
    expect(wrapper.text()).toContain("LicenseKey");
    wrapper.unmount();
  });
});
