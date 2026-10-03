import type { Schedule } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstanceConfigTab from "../src/components/InstanceConfigTab.vue";
import StatusBadge from "../src/components/StatusBadge.vue";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import SchedulesView from "../src/views/SchedulesView.vue";

const schedule: Schedule = {
  id: 4,
  name: "Weekend and news",
  rules: {
    timezone: "Europe/Berlin",
    weekend: { from: { day: 5, time: "21:00" }, to: { day: 0, time: "23:00" } },
    holidays: [{ from: "2026-12-24", to: "2026-12-26", name: "Christmas" }],
    news: { currencies: ["USD"], impact: "high", before: 15, after: 15 },
  },
  instances: ["alpha-ger40"],
  nextPause: {
    start: "2026-10-23T19:00:00.000Z",
    end: "2026-10-25T22:00:00.000Z",
    reasons: ["weekend"],
    labels: [],
  },
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;
/** What the server says in /system about the news calendar. */
let newsCalendar = false;
beforeEach(() => {
  setLocale("en", false);
  session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role: "admin", totpEnabled: false, apiTokens: 0 },
  };
  fetchMock = vi.fn((input: URL, init?: RequestInit) => {
    const path = input.pathname.replace(/^.*\/api\/v1\//, "");
    if (path === "schedules/preview") {
      return Promise.resolve(Response.json([{ ...schedule.nextPause, labels: ["USD Non-Farm Employment Change"] }]));
    }
    if (init?.method === "POST") return Promise.resolve(Response.json({ ...schedule, id: 5 }, { status: 201 }));
    if (init?.method === "PUT") return Promise.resolve(Response.json(schedule));
    if (path === "system") return Promise.resolve(Response.json({ newsCalendar }));
    if (path === "schedules/instances") return Promise.resolve(Response.json(["alpha-ger40", "beta-us30"]));
    return Promise.resolve(Response.json(path === "schedules" ? [schedule] : []));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sent = (method: string) =>
  fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === method)
    .map((c) => ({
      path: (c[0] as URL).pathname.replace(/^.*\/api\/v1\//, ""),
      body: JSON.parse(String((c[1] as RequestInit).body)) as unknown,
    }));

async function open() {
  await router.push("/schedules");
  const wrapper = mount(SchedulesView, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("schedules page", () => {
  it("lists schedules with what they pause, their instances and the next pause", async () => {
    const wrapper = await open();
    const card = wrapper.find(".schedule");
    expect(card.find("h2").text()).toBe("Weekend and news");
    expect(card.find(".meta").text()).toBe(
      "Weekend Friday 21:00 – Sunday 23:00 · 1 holiday · News USD (High only), 15 min before to 15 min after · Europe/Berlin",
    );
    expect(card.text()).toContain("Instances: alpha-ger40");
    expect(card.find(".next").text()).toContain("Weekend");
    wrapper.unmount();
  });

  it("creates a schedule in a modal, with a preview of its pauses", async () => {
    const wrapper = await open();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "New schedule")
      ?.trigger("click");
    await flushPromises();
    const form = wrapper.find("dialog[open] form");
    await form.find("input").setValue("Weekend");
    // Off until chosen.
    expect(form.find("select").exists()).toBe(false);
    await form.find("legend input[type=checkbox]").setValue(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();
    expect(sent("POST").some((c) => c.path === "schedules/preview")).toBe(true);
    expect(form.text()).toContain("USD Non-Farm Employment Change");

    await form.trigger("submit");
    await flushPromises();
    const created = sent("POST").find((c) => c.path === "schedules");
    expect(created?.body).toMatchObject({
      name: "Weekend",
      rules: { weekend: { from: { day: 5, time: "21:00" }, to: { day: 0, time: "23:00" } }, holidays: [] },
    });
    expect(wrapper.text()).toContain("Schedule Weekend and news created.");
    wrapper.unmount();
  });
});

describe("editing a schedule", () => {
  it("opens it with its rules, leaves the list alone until it is saved, and saves the change", async () => {
    const wrapper = await open();
    await wrapper.find(`button[aria-label="Edit: Weekend and news"]`).trigger("click");
    await flushPromises();
    const form = wrapper.find("dialog[open] form");
    expect((form.find("input").element as HTMLInputElement).value).toBe("Weekend and news");
    const [fromDay] = form.findAll("select");
    expect((fromDay?.element as HTMLSelectElement).value).toBe("5");
    await fromDay?.setValue("4");
    expect(schedule.rules.weekend?.from.day).toBe(5);

    await form.trigger("submit");
    await flushPromises();
    const changed = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((changed?.[1] as RequestInit).body))).toMatchObject({
      name: "Weekend and news",
      rules: { weekend: { from: { day: 4, time: "21:00" } }, holidays: [{ from: "2026-12-24", to: "2026-12-26" }] },
    });
    wrapper.unmount();
  });
});

describe("one-off pauses", () => {
  it("are added with a day and time from and to and a name", async () => {
    const wrapper = await open();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "New schedule")
      ?.trigger("click");
    await flushPromises();
    const form = wrapper.find("dialog[open] form");
    await form.find("input").setValue("Maintenance");
    await form
      .findAll("button")
      .find((b) => b.text() === "Add one-off pause")
      ?.trigger("click");
    const [from, to] = form.findAll("input[type=datetime-local]");
    await from?.setValue("2026-10-30T22:00");
    await to?.setValue("2026-10-31T06:00");
    await form.find('input[placeholder="Name (optional), e.g. maintenance"]').setValue("Broker maintenance");
    await form.trigger("submit");
    await flushPromises();
    const created = sent("POST").find((c) => c.path === "schedules");
    expect(created?.body).toMatchObject({
      rules: { periods: [{ from: "2026-10-30T22:00", to: "2026-10-31T06:00", name: "Broker maintenance" }] },
    });
    wrapper.unmount();
  });
});

describe("instances of a schedule", () => {
  it("are chosen in its form, several at once, starting with the ones it has", async () => {
    const wrapper = await open();
    await wrapper.find(`button[aria-label="Edit: Weekend and news"]`).trigger("click");
    await flushPromises();
    const form = wrapper.find("dialog[open] form");
    const boxes = form
      .findAll<HTMLInputElement>("input[type=checkbox][value]")
      .filter((b) => ["alpha-ger40", "beta-us30"].includes(b.element.value));
    expect(boxes.map((b) => [b.element.value, b.element.checked])).toEqual([
      ["alpha-ger40", true],
      ["beta-us30", false],
    ]);
    await boxes[1]?.setValue(true);
    await form.trigger("submit");
    await flushPromises();
    const changed = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((changed?.[1] as RequestInit).body))).toMatchObject({
      instances: ["alpha-ger40", "beta-us30"],
    });
    wrapper.unmount();
  });
});

describe("schedules of an instance", () => {
  it("are chosen on its Configuration tab, several at once", async () => {
    const second = { ...schedule, id: 6, name: "Holidays" };
    fetchMock.mockImplementation((input: URL) => {
      const path = input.pathname.replace(/^.*\/api\/v1\//, "");
      if (path === "schedules") return Promise.resolve(Response.json([second, schedule]));
      return Promise.resolve(path.endsWith("/schedules") ? new Response(null, { status: 204 }) : Response.json([]));
    });
    await router.push("/instances/alpha-ger40/config");
    const managed = {
      id: 3,
      name: "alpha-ger40",
      account: { id: 7, number: "1111111", displayName: "Prop A" },
      createdAt: "2026-09-21T10:00:00.000Z",
      scheduleIds: [4],
      config: {
        version: 1,
        algo: { id: 1, name: "alpha", version: "1" },
        symbol: "GER40",
        period: "M5",
        parameters: {},
        attribution: { mode: "auto" as const },
        createdAt: "2026-09-21T10:00:00.000Z",
      },
      history: [],
    };
    const wrapper = mount(InstanceConfigTab, { props: { managed }, global: { plugins: [i18n, router] } });
    await flushPromises();
    const boxes = wrapper.findAll<HTMLInputElement>(".schedules input[type=checkbox]");
    expect(boxes.map((b) => b.element.checked)).toEqual([false, true]);
    await boxes[0]?.setValue(true);
    await wrapper
      .findAll(".schedules button")
      .find((b) => b.text() === "Save")
      ?.trigger("click");
    await flushPromises();
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect((put?.[0] as URL).pathname).toMatch(/managed-instances\/alpha-ger40\/schedules$/);
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ scheduleIds: [4, 6] });
    wrapper.unmount();
  });
});

describe("news pauses", () => {
  const newsBox = async (calendar: boolean) => {
    newsCalendar = calendar;
    const wrapper = await open();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "New schedule")
      ?.trigger("click");
    await flushPromises();
    const shown = wrapper.find("dialog[open] form").text().includes("Pause around news");
    wrapper.unmount();
    newsCalendar = false;
    return shown;
  };

  it("are offered only with a news calendar (NEWS_CALENDAR_URL)", async () => {
    expect(await newsBox(false)).toBe(false);
    expect(await newsBox(true)).toBe(true);
  });
});

describe("StatusBadge", () => {
  it("shows a paused instance as paused, in words; the server marks only instances that are not up", () => {
    const badge = (paused: boolean) =>
      mount(StatusBadge, { props: { instance: "stopped", paused }, global: { plugins: [i18n] } }).text();
    expect(badge(true)).toBe("Paused");
    expect(badge(false)).toBe("Stopped");
  });
});
