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
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Change password")
      ?.trigger("click");
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

  it("turns 2FA off only with the password and a current code", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "anna", role: "admin", totpEnabled: true },
    };
    fetchMock.mockImplementation((input: URL) =>
      Promise.resolve(
        input.pathname.endsWith("auth/session")
          ? new Response(JSON.stringify({ ...session.value, user: { ...session.value?.user, totpEnabled: false } }))
          : new Response(null, { status: 204 }),
      ),
    );
    const wrapper = mount(ProfileView, { global: { plugins: [i18n] }, attachTo: document.body });
    await wrapper.find('input[type="password"]').setValue("my passphrase");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.findAll(".field__error").map((e) => e.text())).toEqual(["Required."]);
    expect(fetchMock).not.toHaveBeenCalled();

    await wrapper.find('input[autocomplete="one-time-code"]').setValue("123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/auth\/totp\/disable$/);
    expect(JSON.parse(String(init.body))).toEqual({ password: "my passphrase", code: "123456" });
    expect(wrapper.find(".status").text()).toBe("2FA is off. You log in with the password only.");
    wrapper.unmount();
  });

  it("clears a rejected code like the login does", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "anna", role: "admin", totpEnabled: true },
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 })),
    );
    const wrapper = mount(ProfileView, { global: { plugins: [i18n] }, attachTo: document.body });
    await wrapper.find('input[type="password"]').setValue("my passphrase");
    const code = wrapper.find<HTMLInputElement>('input[autocomplete="one-time-code"]');
    await code.setValue("123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe("User name, password or code is wrong.");
    expect(code.element.value).toBe("");
    expect(session.value?.user?.totpEnabled).toBe(true);
    wrapper.unmount();
  });
});
