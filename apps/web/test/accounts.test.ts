import type { Account, Credential } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import AccountsView from "../src/views/AccountsView.vue";

const accounts: Account[] = [
  {
    id: 1,
    adapter: "demo",
    number: "1111111",
    broker: "Demo",
    currency: "USD",
    displayName: "Prop A",
    credentialId: 1,
    credentialLabel: "Login A",
    timezone: null,
    hasChallenge: true,
  },
];
const credentials: Credential[] = [
  { id: 1, label: "Login A", login: "me@example.com", createdAt: "2026-09-01T00:00:00.000Z", accounts: 1 },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  fetchMock = vi.fn((input: URL) => {
    const body = input.pathname.endsWith("/accounts")
      ? accounts
      : input.pathname.endsWith("/credentials")
        ? credentials
        : [];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const render = async () => {
  const wrapper = mount(AccountsView, { global: { plugins: [i18n, router] } });
  await flushPromises();
  return wrapper;
};

describe("AccountsView", () => {
  it("shows accounts and logins to admins, never a password", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    expect(wrapper.text()).toContain("Prop A");
    expect(wrapper.text()).toContain("me@example.com");
    // A login in use cannot be removed.
    const removeLogin = wrapper
      .findAll("section[aria-labelledby=logins-title] .table-wrap button")
      .find((b) => b.attributes("aria-label")?.startsWith("Remove") === true);
    expect(removeLogin?.attributes("disabled")).toBeDefined();
    // The reason shows as tooltip and is read out with the button.
    const reason = wrapper.find(`#${removeLogin?.attributes("aria-describedby") ?? ""}`).text();
    expect(reason).toMatch(/^Used by accounts/);
    expect(removeLogin?.element.parentElement?.dataset["tooltip"]).toBe(reason);
  });

  it("marks the empty fields of a new login instead of sending it, and clears them after saving", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    // "Add login" is a button that opens the form in a modal.
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Add login")
      ?.trigger("click");
    const form = wrapper.find("dialog form");
    await form.trigger("submit");
    await flushPromises();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
    expect(form.findAll(".field__error").map((e) => e.text())).toEqual(["Required.", "Required.", "Required."]);

    const inputs = form.findAll("input");
    await inputs[0]?.setValue("Spotware demo");
    await inputs[1]?.setValue(" me@example.com ");
    await inputs[2]?.setValue("secret");
    expect((inputs[1]?.element as HTMLInputElement).value).toBe("me@example.com");
    await form.trigger("submit");
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      label: "Spotware demo",
      login: "me@example.com",
      secret: "secret",
    });
    // Saved: the modal closes and the page says so.
    expect(wrapper.find("dialog form").exists()).toBe(false);
    expect(wrapper.find(".status").text()).toBe("Login added.");
  });

  it("edits an account and changes a password in the modal, like adding", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    const sent = (method: string) =>
      fetchMock.mock.calls
        .filter((c) => (c[1] as RequestInit | undefined)?.method === method)
        .map((c) => [(c[0] as URL).pathname, JSON.parse(String((c[1] as RequestInit).body)) as unknown]);

    await wrapper.find('button[aria-label="Edit: Prop A"]').trigger("click");
    expect(wrapper.find("dialog h2").text()).toBe("Edit: Prop A");
    await wrapper.find("dialog input").setValue("Prop A renamed");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(sent("PATCH")[0]).toEqual([
      expect.stringMatching(/accounts\/1$/) as unknown,
      { displayName: "Prop A renamed", credentialId: 1 },
    ]);
    expect(wrapper.find("dialog form").exists()).toBe(false);

    await wrapper.find('button[aria-label="Change password: Login A"]').trigger("click");
    await wrapper.find('dialog input[type="password"]').setValue("new secret");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(sent("PATCH")[1]).toEqual([expect.stringMatching(/credentials\/1$/) as unknown, { secret: "new secret" }]);
  });

  it("shows a spinner on the button whose broker call runs, and only there", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    // The broker answers only when the test says so.
    let answer: (response: Response) => void = () => undefined;
    const fallback = fetchMock.getMockImplementation() as (input: URL) => Promise<Response>;
    fetchMock.mockImplementation((input: URL) =>
      input.pathname.endsWith("/broker-accounts")
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : fallback(input),
    );
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Add account")
      ?.trigger("click");
    await wrapper.find("dialog select").setValue("1");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    const fetchButton = () => wrapper.findAll("dialog button").find((b) => b.text() === "Get accounts from the broker");
    expect(fetchButton()?.attributes("aria-busy")).toBe("true");
    expect(fetchButton()?.attributes("disabled")).toBeDefined();
    // Elsewhere on the page nothing spins.
    expect(wrapper.findAll('[aria-busy="true"]')).toHaveLength(1);

    answer(new Response(JSON.stringify([{ number: "2222222", name: "Prop B" }]), { status: 200 }));
    await flushPromises();
    expect(wrapper.findAll('[aria-busy="true"]')).toHaveLength(0);
    expect(wrapper.find("dialog").text()).toContain("2222222");
  });

  it("shows viewers the accounts only, without actions or logins", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "v", role: "viewer", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    expect(wrapper.text()).toContain("Prop A");
    expect(wrapper.findAll("button").filter((b) => !b.element.closest("dialog"))).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Broker logins");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/credentials"))).toBe(false);
  });
});
