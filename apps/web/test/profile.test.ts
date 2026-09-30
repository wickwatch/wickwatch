import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { session } from "../src/session";
import ProfileView from "../src/views/ProfileView.vue";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "anna", role: "admin", totpEnabled: false },
  };
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileView", () => {
  it("changes the password in a modal after checking length and repetition", async () => {
    const wrapper = mount(ProfileView, { global: { plugins: [i18n] }, attachTo: document.body });
    await wrapper.find('button[aria-label="Change password"]').trigger("click");
    const inputs = wrapper.findAll('dialog input[type="password"]');
    await inputs[0]?.setValue("old passphrase");
    await inputs[1]?.setValue("too short");
    await inputs[2]?.setValue("something else");
    await wrapper.find("dialog form").trigger("submit");
    expect(wrapper.findAll("dialog .field__error").map((e) => e.text())).toEqual([
      "At least 12 characters.",
      "Does not match.",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    await inputs[1]?.setValue("a new passphrase");
    await inputs[2]?.setValue("a new passphrase");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/auth\/password$/);
    expect(JSON.parse(String(init.body))).toEqual({ current: "old passphrase", next: "a new passphrase" });
    expect(wrapper.find("dialog form").exists()).toBe(false);
    expect(wrapper.find(".status").text()).toBe("Password changed. Other sessions are logged out.");
    wrapper.unmount();
  });
});
