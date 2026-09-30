import type { ChallengeProfile } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import ChallengeForm from "../src/components/ChallengeForm.vue";
import { session } from "../src/session";

const saved: ChallengeProfile = {
  name: "Challenge",
  startDate: "2026-09-01",
  startBalance: 100_000,
  rules: {
    dailyLoss: { limitPct: 5, reference: "balance-at-day-start", resetTime: "00:00", timezone: "Europe/Prague" },
  },
};
let puts: unknown[];

beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false },
  };
  puts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return Promise.resolve(new Response(String(init.body), { status: 200 }));
      }
      const body = input.pathname.endsWith("/challenge-templates") ? [] : saved;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChallengeForm", () => {
  it("is off by default and saves the guard only when switched on", async () => {
    const wrapper = mount(ChallengeForm, { props: { number: "1111111" }, global: { plugins: [i18n] } });
    await flushPromises();
    const box = wrapper.find('input[type="checkbox"]');
    expect((box.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.text()).toContain("closes all positions, manual ones too");

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(puts[0]).not.toHaveProperty("guard");

    await box.setValue(true);
    const pct = wrapper.find('input[type="number"][min="10"]');
    await pct.setValue("5");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(puts).toHaveLength(1);
    expect(wrapper.find(".field__error").text()).toBe("At least 10.");

    await pct.setValue("80");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(puts[1]).toMatchObject({ guard: { usagePct: 80 } });
  });

  it("tells whether inputs changed, and reports a save instead of navigating", async () => {
    const wrapper = mount(ChallengeForm, { props: { number: "1111111" }, global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.emitted("dirty")).toBeUndefined();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([true]);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });
});
