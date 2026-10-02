import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiToken } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { session } from "../src/session";
import { system } from "../src/system";
import ApiTokensView from "../src/views/ApiTokensView.vue";

const TOKEN: ApiToken = {
  id: 1,
  name: "grafana",
  prefix: "ww_abcdef",
  role: "viewer",
  user: "anna",
  createdAt: "2026-10-01T08:00:00.000Z",
  expired: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
let listed: ApiToken[];
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "anna", role: "admin", totpEnabled: true, apiTokens: 0 },
  };
  listed = [TOKEN, { ...TOKEN, id: 2, name: "old", expiresAt: "2026-09-01T00:00:00.000Z", expired: true }];
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; role: string };
      const created = { ...TOKEN, id: 3, name: body.name, token: "ww_abcdef-placeholder-token" };
      listed = [created, ...listed];
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
    }
    if (init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response(JSON.stringify(input.pathname.endsWith("api-tokens") ? listed : {})));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  system.value = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function render() {
  // RouterLink stubbed: a real router would load /system and replace the test's system info.
  const wrapper = mount(ApiTokensView, {
    global: { plugins: [i18n], stubs: { RouterLink: true } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

describe("ApiTokensView", () => {
  it("lists tokens by prefix, with expiry in words", async () => {
    const wrapper = await render();
    const rows = wrapper.findAll("tbody tr").map((r) => r.findAll("td").map((c) => c.text()));
    expect(rows[0]?.slice(0, 4)).toEqual(["grafana", "ww_abcdef…", "Viewer", "anna"]);
    expect(rows[0]?.[5]).toBe("Never");
    expect(rows[0]?.[6]).toBe("Not used yet");
    expect(rows[1]?.[5]).toBe("Expired");
    expect(wrapper.text()).toContain("Authorization: Bearer <token>");
    wrapper.unmount();
  });

  it("creates a viewer token with the default expiry and shows it once", async () => {
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Create token")
      ?.trigger("click");
    await wrapper.find("dialog form").trigger("submit");
    // Name, password and (2FA is on) the code.
    expect(wrapper.findAll("dialog .field__error").map((e) => e.text())).toEqual([
      "Required.",
      "Required.",
      "Required.",
    ]);

    await wrapper.find("dialog input").setValue("  claude  ");
    await wrapper.find('dialog input[type="password"]').setValue("my passphrase");
    await wrapper.find('dialog input[autocomplete="one-time-code"]').setValue("123456");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST") as [
      URL,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      name: "claude",
      role: "viewer",
      expiresInDays: 90,
      password: "my passphrase",
      code: "123456",
    });
    expect((wrapper.find("#api-token-value").element as HTMLInputElement).value).toBe("ww_abcdef-placeholder-token");
    expect(wrapper.find(".status").text()).toBe("Token claude created.");

    await wrapper
      .findAll("dialog button")
      .find((b) => b.text() === "Done")
      ?.trigger("click");
    expect(wrapper.find("#api-token-value").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("ww_abcdef-placeholder-token");
    wrapper.unmount();
  });

  it("says why no token can be created when the server requires 2FA and the user has none", async () => {
    system.value = { mcp: true, apiTokensRequire2fa: true } as typeof system.value;
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "anna", role: "admin", totpEnabled: false, apiTokens: 0 },
    };
    const wrapper = await render();
    expect(wrapper.findAll("button").some((b) => b.text() === "Create token")).toBe(false);
    expect(wrapper.find(".tone-warning").text()).toContain("Creating tokens needs 2FA on this server");
    wrapper.unmount();
  });

  it("says when MCP is switched off on the server, without its address", async () => {
    system.value = { mcp: false } as typeof system.value;
    const wrapper = await render();
    const panel = wrapper.find('[aria-labelledby="mcp-title"]');
    expect(panel.find(".pill").text()).toBe("Off");
    expect(panel.text()).toContain("Switched off on the server (MCP=off).");
    expect(panel.find("dl").exists()).toBe(false);
    wrapper.unmount();
  });

  it("is for admins only", async () => {
    session.value = {
      setupRequired: false,
      masterKeyConfigured: true,
      user: { username: "bob", role: "viewer", totpEnabled: true, apiTokens: 0 },
    };
    const wrapper = await render();
    expect(wrapper.find('[role="alert"]').text()).toBe("Your role does not allow this.");
    expect(fetchMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
