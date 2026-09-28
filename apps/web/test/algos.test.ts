import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlgoRow } from "../src/api";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import AlgosView from "../src/views/AlgosView.vue";

const algos: AlgoRow[] = [
  {
    id: 2,
    name: "SampleBot",
    version: "1.1.0",
    sha256: "b".repeat(64),
    size: 40960,
    buildTime: "2026-09-18T13:33:03.586Z",
    fullAccess: true,
    parameters: [
      { name: "Period", type: "int", label: "ATR period", group: "Signal", default: 14, min: 5, max: 50 },
      { name: "Mode", type: "enum", default: "Slow", options: ["Fast", "Slow"] },
    ],
    uploadedAt: "2026-09-20T10:00:00.000Z",
  },
  {
    id: 1,
    name: "SampleBot",
    version: "1.0.0",
    sha256: "a".repeat(64),
    size: 38912,
    fullAccess: false,
    parameters: [],
    uploadedAt: "2026-09-19T10:00:00.000Z",
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setLocale("en", false);
  fetchMock = vi.fn((_input: URL, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: "algo_version_exists", message: "exists" }), { status: 409 })
        : init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(algos), { status: 200 }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const asRole = (role: "admin" | "viewer") =>
  (session.value = {
    setupRequired: false,
    masterKeyConfigured: true,
    user: { username: "a", role, totpEnabled: false },
  });
const render = async () => {
  const wrapper = mount(AlgosView, { global: { plugins: [i18n, router] } });
  await flushPromises();
  return wrapper;
};

describe("AlgosView", () => {
  it("groups versions by algo and shows parameters and the full-access marker", async () => {
    asRole("viewer");
    const wrapper = await render();
    expect(wrapper.findAll("section h2").map((h) => h.text())).toEqual(["SampleBot"]);
    expect(wrapper.text()).toContain("1.1.0");
    expect(wrapper.text()).toContain("Needs full access");
    expect(wrapper.text()).toContain("2 parameters");
    expect(wrapper.text()).toContain("ATR period");
    expect(wrapper.text()).toContain("5 … 50");
    expect(wrapper.text()).toContain("Fast | Slow");
    // Viewers can neither upload nor delete.
    expect(wrapper.find("input[type=file]").exists()).toBe(false);
    expect(wrapper.findAll(".version button")).toHaveLength(0);
  });

  it("uploads as octet-stream and shows a translated error", async () => {
    asRole("admin");
    const wrapper = await render();
    const input = wrapper.find("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [new File(["x"], "SampleBot.algo")] });
    await input.trigger("change");
    await wrapper.find("input.mono").setValue("1.0.0");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST") as [
      URL,
      RequestInit,
    ];
    expect(url.search).toBe("?fileName=SampleBot.algo&version=1.0.0");
    expect(new Headers(init.headers).get("content-type")).toBe("application/octet-stream");
    expect(wrapper.find("[role=alert]").text()).toBe("This version already exists; enter another version.");
  });

  it("shows no field problem after a successful upload clears the form", async () => {
    asRole("admin");
    fetchMock.mockImplementation((_input: URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "POST"
          ? new Response(JSON.stringify(algos[0]), { status: 201 })
          : new Response(JSON.stringify(algos), { status: 200 }),
      ),
    );
    const wrapper = await render();
    const input = wrapper.find("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [new File(["x"], "SampleBot.algo")], configurable: true });
    await input.trigger("change");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("uploaded");
    expect(wrapper.findAll(".field__error")).toHaveLength(0);
    expect(input.attributes("aria-invalid")).toBeUndefined();
  });

  it("deletes a version only after confirmation", async () => {
    asRole("admin");
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Delete")[1]
      ?.trigger("click");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    await wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("confirm");
    await flushPromises();
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE") as [URL];
    expect(del[0].pathname).toMatch(/\/algos\/1$/);
    expect(wrapper.text()).toContain("SampleBot 1.0.0 deleted.");
  });
});
