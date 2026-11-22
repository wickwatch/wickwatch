import type { Algo, ParameterTemplate } from "@wickwatch/core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setLocale } from "../src/i18n";
import { router } from "../src/router";
import { session } from "../src/session";
import AlgosView from "../src/views/AlgosView.vue";

const algos: Algo[] = [
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

let templates: ParameterTemplate[] = [];
let instances: unknown[] = [];
const managed = (input: URL) =>
  input.pathname.endsWith("/managed-instances") ? new Response(JSON.stringify(instances), { status: 200 }) : undefined;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  templates = [];
  instances = [];
  setLocale("en", false);
  fetchMock = vi.fn((input: URL, init?: RequestInit) =>
    Promise.resolve(
      managed(input) ??
        // The platform card has its own tests (platform.test.ts).
        (input.pathname.endsWith("/platform")
          ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
          : input.pathname.endsWith("/parameter-templates") && !init?.method
            ? new Response(JSON.stringify(templates), { status: 200 })
            : init?.method === "POST"
              ? new Response(JSON.stringify({ error: "algo_version_exists", message: "exists" }), { status: 409 })
              : init?.method === "DELETE"
                ? new Response(null, { status: 204 })
                : new Response(JSON.stringify(algos), { status: 200 })),
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
    user: { username: "a", role, totpEnabled: false, apiTokens: 0 },
  });
const render = async () => {
  const wrapper = mount(AlgosView, { global: { plugins: [i18n, router] } });
  await flushPromises();
  return wrapper;
};
/** "Upload algo" is a button that opens the form in a modal. */
const openUpload = async (wrapper: Awaited<ReturnType<typeof render>>) => {
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Upload algo")
    ?.trigger("click");
};

describe("AlgosView", () => {
  it("groups versions by algo and shows parameters and the full-access marker", async () => {
    asRole("viewer");
    const wrapper = await render();
    expect(wrapper.findAll("section > h2").map((h) => h.text())).toEqual(["SampleBot"]);
    expect(wrapper.text()).toContain("1.1.0");
    expect(wrapper.text()).toContain("Needs full access");
    expect(wrapper.text()).toContain("2 parameters");
    expect(wrapper.text()).toContain("ATR period");
    expect(wrapper.text()).toContain("5 … 50");
    expect(wrapper.text()).toContain("Fast | Slow");
    // Viewers can neither upload nor delete.
    expect(wrapper.find("input[type=file]").exists()).toBe(false);
    expect(wrapper.findAll(".version .btn--danger")).toHaveLength(0);
  });

  it("uploads as octet-stream and shows a translated error", async () => {
    asRole("admin");
    const wrapper = await render();
    await openUpload(wrapper);
    const input = wrapper.find("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [new File(["x"], "SampleBot.algo")] });
    await input.trigger("change");
    // The same drop zone as for parameter files; it names the chosen file until the upload.
    expect(wrapper.find(".dropzone__selected").text()).toBe("Selected: SampleBot.algo");
    await wrapper.find("input.mono").setValue("1.0.0");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST") as [
      URL,
      RequestInit,
    ];
    expect(url.search).toBe("?fileName=SampleBot.algo&version=1.0.0");
    expect(new Headers(init.headers).get("content-type")).toBe("application/octet-stream");
    // The error stays inside the modal, next to the input to fix.
    expect(wrapper.find("dialog [role=alert]").text()).toBe("This version already exists; enter another version.");
  });

  it("closes the modal after a successful upload and opens it empty again", async () => {
    asRole("admin");
    fetchMock.mockImplementation((input: URL, init?: RequestInit) =>
      Promise.resolve(
        managed(input) ??
          (input.pathname.endsWith("/platform")
            ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
            : init?.method === "POST"
              ? new Response(JSON.stringify(algos[0]), { status: 201 })
              : new Response(JSON.stringify(input.pathname.endsWith("/parameter-templates") ? [] : algos), {
                  status: 200,
                })),
      ),
    );
    const wrapper = await render();
    await openUpload(wrapper);
    const input = wrapper.find("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [new File(["x"], "SampleBot.algo")], configurable: true });
    await input.trigger("change");
    await wrapper.find("dialog form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("uploaded");
    // The modal closed; opened again, the form is empty and shows no problem.
    expect(wrapper.find("dialog form").exists()).toBe(false);
    await openUpload(wrapper);
    expect(wrapper.findAll(".field__error")).toHaveLength(0);
    expect(wrapper.find("input[type=file]").attributes("aria-invalid")).toBeUndefined();
  });

  it("deletes a version only after confirmation", async () => {
    asRole("admin");
    const wrapper = await render();
    await wrapper
      .findAll("button")
      .filter((b) => b.text() === "Delete")[1]
      ?.trigger("click");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    const dialog = wrapper.findAllComponents({ name: "ConfirmDialog" }).find((d) => d.props("open") === true);
    await dialog?.vm.$emit("confirm");
    await flushPromises();
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE") as [URL];
    expect(del[0].pathname).toMatch(/\/algos\/1$/);
    expect(wrapper.text()).toContain("SampleBot 1.0.0 deleted.");
  });

  it("moves instances on an older version to the newest one, with a preview of their parameters", async () => {
    asRole("admin");
    const instance = (name: string, algoId: number, version: string) => ({
      name,
      config: { algo: { id: algoId, name: "SampleBot", version } },
    });
    instances = [instance("x1", 1, "1.0.0"), instance("x2", 1, "1.0.0"), instance("x3", 2, "1.1.0")];
    const candidate = (name: string, extra: Record<string, unknown> = {}) => ({
      name,
      account: { id: 1, number: "1111111", displayName: "Demo" },
      from: { id: 1, version: "1.0.0" },
      configVersion: 3,
      deployed: true,
      added: [],
      dropped: [],
      newDefaults: [],
      rejected: [],
      issues: [],
      ...extra,
    });
    const preview = {
      algo: { id: 2, name: "SampleBot", version: "1.1.0" },
      instances: [
        candidate("x1", { added: ["Period"], newDefaults: [{ parameter: "Mode", from: "Fast", to: "Slow" }] }),
        candidate("x2", { issues: [{ parameter: "Period", code: "below_min" }] }),
      ],
    };
    const posted: unknown[] = [];
    fetchMock.mockImplementation((input: URL, init?: RequestInit) => {
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      if (input.pathname.endsWith("/algo-update") && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return json({ saved: ["x1"], failed: [] });
      }
      if (input.pathname.endsWith("/algo-update")) return json(preview);
      if (input.pathname.endsWith("/algo-rollout")) return json({});
      if (input.pathname.endsWith("/platform")) return Promise.resolve(new Response("{}", { status: 404 }));
      if (input.pathname.endsWith("/parameter-templates") || input.pathname.endsWith("/algo-settings")) return json([]);
      return Promise.resolve(managed(input) ?? new Response(JSON.stringify(algos), { status: 200 }));
    });
    const wrapper = await render();
    expect(wrapper.text()).toContain("In use by x1, x2");
    expect(wrapper.text()).toContain("In use by x3");
    const open = wrapper.findAll("button").filter((b) => b.text() === "Update 2 instances");
    // Only at the newest version.
    expect(open).toHaveLength(1);
    await open[0]?.trigger("click");
    await flushPromises();

    // The page has more modals (upload, templates); this one is open.
    const find = () => wrapper.findAll("dialog").find((d) => d.text().includes("Move instances to SampleBot 1.1.0"));
    const dialog = find();
    if (!dialog) throw new Error("dialog not open");
    expect(dialog.text()).toContain("New, with their default: ATR period");
    expect(dialog.text()).toContain("Follow the new default: Mode Fast → Slow");
    expect(dialog.text()).toContain("Not possible, needs a manual edit first: ATR period (Below minimum)");
    const boxes = dialog.findAll(".candidate input[type=checkbox]");
    expect(boxes.map((b) => (b.element as HTMLInputElement).checked)).toEqual([true, false]);
    expect(boxes[1]?.attributes("disabled")).toBeDefined();

    // Deploying is a choice; the button says what happens.
    await dialog.find(".check input").setValue(true);
    expect(dialog.find("button[type=submit]").text()).toBe("Save and deploy 1");
    await dialog.find(".check input").setValue(false);
    await dialog.find("form").trigger("submit");
    await flushPromises();
    expect(posted).toEqual([{ algoId: 2, instances: ["x1"], comment: "Update to 1.1.0" }]);
    expect(find()?.text()).toContain("New configuration version on 1.1.0 for: x1.");
  });
});
