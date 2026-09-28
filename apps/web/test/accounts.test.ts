import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, CredentialRow } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import AccountsView from "../src/views/AccountsView.vue";

const accounts: AccountRow[] = [
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
const credentials: CredentialRow[] = [
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
      user: { username: "a", role: "admin", totpEnabled: false },
    };
    const wrapper = await render();
    expect(wrapper.text()).toContain("Prop A");
    expect(wrapper.text()).toContain("me@example.com");
    // A login in use cannot be removed.
    const removeLogin = wrapper.findAll("#logins-title ~ .table-wrap button").find((b) => b.text() === "Remove");
    expect(removeLogin?.attributes("disabled")).toBeDefined();
  });

  it("marks the empty fields of a new login instead of sending it, and clears them after saving", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "a", role: "admin", totpEnabled: false },
    };
    const wrapper = await render();
    const form = wrapper.findAll("form").at(-1);
    await form?.trigger("submit");
    await flushPromises();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
    expect(form?.findAll(".field__error").map((e) => e.text())).toEqual(["Required.", "Required.", "Required."]);

    const inputs = form?.findAll("input") ?? [];
    await inputs[0]?.setValue("Spotware demo");
    await inputs[1]?.setValue(" me@example.com ");
    await inputs[2]?.setValue("secret");
    expect((inputs[1]?.element as HTMLInputElement).value).toBe("me@example.com");
    await form?.trigger("submit");
    await flushPromises();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      label: "Spotware demo",
      login: "me@example.com",
      secret: "secret",
    });
    // The cleared form shows no "Required." until the next attempt.
    expect(form?.findAll(".field__error")).toHaveLength(0);
  });

  it("shows viewers the accounts only, without actions or logins", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "v", role: "viewer", totpEnabled: false },
    };
    const wrapper = await render();
    expect(wrapper.text()).toContain("Prop A");
    expect(wrapper.findAll("button").filter((b) => !b.element.closest("dialog"))).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Broker logins");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/credentials"))).toBe(false);
  });
});
