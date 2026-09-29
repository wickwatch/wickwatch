import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppHeader from "../src/components/AppHeader.vue";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { initials, session } from "../src/session";
import { themeMode } from "../src/theme";

beforeEach(() => {
  setLocale("en", false);
  themeMode.value = "system";
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "Martin M.", role: "admin", totpEnabled: true },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) =>
      Promise.resolve(
        new Response("{}", {
          status: input.pathname.endsWith("/auth/logout") ? 200 : 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function render() {
  const wrapper = mount(AppHeader, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("initials", () => {
  it("takes up to two letters from the user name", () => {
    expect(initials("Martin M.")).toBe("MM");
    expect(initials("martin.mohr")).toBe("MM");
    expect(initials("admin")).toBe("A");
  });
});

describe("AppHeader", () => {
  it("shows the user with initials and role; the menu offers profile and logout", async () => {
    const wrapper = await render();
    const trigger = wrapper.find(".user-menu button");
    expect(trigger.find(".user__avatar").text()).toBe("MM");
    expect(trigger.text()).toContain("Martin M.");
    expect(trigger.text()).toContain("Admin");
    expect(trigger.text()).toContain("User menu");
    expect(trigger.attributes("aria-label")).toBeUndefined();

    await trigger.trigger("click");
    const menu = wrapper.find('.user-menu [role="menu"]');
    expect(menu.text()).toContain("Signed in as Martin M.");
    const items = menu.findAll('[role="menuitem"]');
    expect(items.map((i) => i.text())).toEqual(["Profile", "Log out"]);
    expect(menu.find('[role="separator"]').exists()).toBe(true);

    await items[0]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("profile");
  });

  it("logs out from the user menu", async () => {
    const wrapper = await render();
    await wrapper.find(".user-menu button").trigger("click");
    await wrapper.findAll('.user-menu [role="menuitem"]')[1]!.trigger("click");
    await flushPromises();
    expect(session.value?.user).toBeUndefined();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("names the icon-only header buttons for tooltips and screen readers", async () => {
    const wrapper = await render();
    const language = wrapper.find('button[aria-label="Language: English"]');
    expect(language.attributes("title")).toBe("Language: English");
    expect(wrapper.find('button[aria-label="Theme: System"]').exists()).toBe(true);
  });

  it("switches the language from the flag menu and marks the active one with a check, not colour alone", async () => {
    const wrapper = await render();
    const trigger = wrapper.find('button[aria-label="Language: English"]');
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    const items = wrapper.findAll('[role="menuitemradio"]');
    expect(items.map((i) => i.text())).toEqual(["English", "Deutsch"]);
    expect(items[0]!.attributes("aria-checked")).toBe("true");
    expect(items[0]!.find(".menu__check").exists()).toBe(true);
    expect(items[1]!.attributes("lang")).toBe("de");

    await items[1]!.trigger("click");
    expect(i18n.global.locale.value).toBe("de");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Sprache: Deutsch"]').exists()).toBe(true);
  });

  it("moves through the theme menu with the keyboard and returns focus on Escape", async () => {
    const wrapper = await render();
    const trigger = wrapper.find('button[aria-label="Theme: System"]');
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    const items = wrapper.findAll('[role="menuitemradio"]');
    expect(items.map((i) => i.text())).toEqual(["System", "Dark", "Light"]);
    expect(document.activeElement).toBe(items[0]!.element);

    await wrapper.find('[role="menu"]').trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]!.element);
    await wrapper.find('[role="menu"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);

    await trigger.trigger("click");
    await wrapper.findAll('[role="menuitemradio"]')[2]!.trigger("click");
    expect(themeMode.value).toBe("light");
  });
});
