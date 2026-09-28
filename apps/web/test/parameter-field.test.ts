import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ParameterField from "../src/components/ParameterField.vue";
import { i18n, setLocale } from "../src/i18n";

beforeEach(() => {
  setLocale("en", false);
});

describe("ParameterField", () => {
  it("edits colours as #AARRGGBB and keeps the alpha when a colour is picked", async () => {
    const wrapper = mount(ParameterField, {
      props: { param: { name: "SLColor", type: "color", default: "#FFFF0000" }, modelValue: "#80FF0000" },
      global: { plugins: [i18n] },
    });
    expect((wrapper.find("input.input").element as HTMLInputElement).value).toBe("#80FF0000");
    const picker = wrapper.find('input[type="color"]');
    expect((picker.element as HTMLInputElement).value).toBe("#ff0000");
    await picker.setValue("#00ff00");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["#8000FF00"]);
    expect(wrapper.text()).toContain("Default #FFFF0000");
  });
});
