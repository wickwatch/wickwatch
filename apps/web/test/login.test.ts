import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import LoginView from "../src/views/LoginView.vue";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}))));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginView", () => {
  it("stays logged in unless the box is cleared", async () => {
    const wrapper = mount(LoginView, { global: { plugins: [i18n, router] }, attachTo: document.body });
    const check = wrapper.find<HTMLInputElement>('input[type="checkbox"]');
    expect(check.element.checked).toBe(true);
    expect(check.element.closest("label")?.textContent?.trim()).toBe("Stay logged in");
    const info = wrapper.find('button[aria-label="About “Stay logged in”"]');
    expect(info.attributes("data-tooltip")).toMatch(/^Keeps you logged in for 30 days/);
    const hint = wrapper.find(".remember__hint");
    expect(hint.isVisible()).toBe(false);
    await info.trigger("click");
    expect(hint.isVisible()).toBe(true);

    const body = async () => {
      await wrapper.find('input[autocomplete="username"]').setValue("anna");
      await wrapper.find('input[type="password"]').setValue("a passphrase");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      const call = fetchMock.mock.calls.find(([url]) => (url as URL).pathname.endsWith("auth/login"));
      fetchMock.mockClear();
      return JSON.parse(String((call?.[1] as RequestInit).body)) as unknown;
    };
    expect(await body()).toEqual({ username: "anna", password: "a passphrase", remember: true });
    await check.setValue(false);
    expect(await body()).toEqual({ username: "anna", password: "a passphrase", remember: false });
    wrapper.unmount();
  });
});
