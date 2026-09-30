import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref, withDirectives } from "vue";
import { checks, normalizers, useValidation, vNormalize } from "../src/validation";

describe("checks", () => {
  it("reports forbidden characters while typing and format problems later", () => {
    expect(checks.instanceName("probe-demo")).toBeUndefined();
    expect(checks.instanceName("Test")).toEqual({ key: "validation.characters", params: { chars: "T" }, live: true });
    expect(checks.instanceName("a b.c")).toMatchObject({ params: { chars: "␣ ." } });
    expect(checks.instanceName("probe-")).toEqual({ key: "validation.instanceName" });
    expect(checks.instanceName("")).toBeUndefined();
    expect(checks.required(" ")).toEqual({ key: "validation.required" });
  });

  it("checks numbers, time zones, regular expressions and lists", () => {
    const pct = checks.number({ min: 0.1, max: 100 });
    expect(pct("")).toBeUndefined();
    expect(pct(0.05)).toEqual({ key: "validation.min", params: { min: 0.1 } });
    expect(pct(101)).toEqual({ key: "validation.max", params: { max: 100 } });
    expect(checks.number({ integer: true })(1.5)).toEqual({ key: "validation.integer" });
    expect(checks.timeZone("Europe/Berlin")).toBeUndefined();
    expect(checks.timeZone("Mars/Olympus")).toEqual({ key: "validation.timeZone" });
    expect(checks.regex("^alpha-(a|b)$")).toBeUndefined();
    expect(checks.regex("(")).toEqual({ key: "validation.regex" });
    const symbol = checks.oneOf(() => ["US100.cash"], "validation.unknownSymbol");
    expect(symbol("us100.CASH")).toBeUndefined();
    expect(symbol("DAX")).toEqual({ key: "validation.unknownSymbol" });
    // Unknown list (e.g. the broker could not be asked): no judgement.
    expect(checks.oneOf(() => [], "x")("DAX")).toBeUndefined();
  });
});

describe("vNormalize", () => {
  it("rewrites the input for v-model and keeps the cursor", async () => {
    const value = ref("");
    // Like v-model: the last input event carries the value the model ends up with.
    const wrapper = mount(
      defineComponent({
        render: () =>
          withDirectives(
            h("input", {
              onInput: (e: Event) => {
                value.value = (e.target as HTMLInputElement).value;
              },
            }),
            [[vNormalize, normalizers.slug]],
          ),
      }),
    );
    const input = wrapper.find("input").element as HTMLInputElement;
    input.value = "Probe Demo";
    input.setSelectionRange(3, 3);
    await wrapper.find("input").trigger("input");
    expect(value.value).toBe("probe-demo");
    expect(input.selectionStart).toBe(3);
    expect(normalizers.digits("123 456")).toBe("123456");
  });
});

describe("useValidation", () => {
  const Form = defineComponent({
    setup() {
      const value = ref("");
      const field = useValidation().field(() => value.value, checks.required);
      return () => h("div", [h("input", field.attrs.value), field.shown.value ? h("p", field.shown.value.key) : null]);
    },
  });

  it("shows a problem after leaving the field, not after switching to another window", async () => {
    const wrapper = mount(Form);
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await wrapper.find("input").trigger("blur");
    expect(wrapper.find("p").exists()).toBe(false);
    hasFocus.mockReturnValue(true);
    await wrapper.find("input").trigger("blur");
    expect(wrapper.find("p").text()).toBe("validation.required");
    hasFocus.mockRestore();
  });
});
