import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTags, registryOf } from "../src/services/registry";
import { loginAs, startApp, type TestApp } from "./helpers";

const DEMO = "wickwatch-demo-runtime";

/** A registry that wants an anonymous token and pages its tags two at a time. */
function fakeRegistry(tags: Record<string, string[]>, calls: string[] = []): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.href);
    if (url.pathname === "/token") {
      return Response.json({ token: `t-${url.searchParams.get("scope") ?? ""}` });
    }
    const name = /^\/v2\/(.+)\/tags\/list$/.exec(url.pathname)?.[1] ?? "";
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer t-repository:${name}:pull`) {
      return new Response("", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer realm="https://${url.host}/token",service="${url.host}",scope="repository:${name}:pull"`,
        },
      });
    }
    const all = tags[`${url.host}/${name}`];
    if (!all) return new Response("", { status: 404 });
    const from = Number(url.searchParams.get("last") ?? 0);
    const page = all.slice(from, from + 2);
    const more = from + 2 < all.length;
    return Response.json(
      { name, tags: page },
      more ? { headers: { link: `</v2/${name}/tags/list?n=2&last=${String(from + 2)}>; rel="next"` } } : {},
    );
  };
}

describe("registry", () => {
  it("knows where an image repository lives", () => {
    expect(registryOf("ghcr.io/example/platform")).toEqual({ host: "ghcr.io", name: "example/platform" });
    expect(registryOf("localhost:5000/platform")).toEqual({ host: "localhost:5000", name: "platform" });
    expect(registryOf("example/platform")).toEqual({ host: "registry-1.docker.io", name: "example/platform" });
    expect(registryOf("platform")).toEqual({ host: "registry-1.docker.io", name: "library/platform" });
  });

  it("lists all tags with an anonymous token, page by page", async () => {
    const calls: string[] = [];
    const fetchFn = fakeRegistry({ "ghcr.io/example/platform": ["1.0", "1.1", "2.0-alpha", "2.0", "2.1"] }, calls);
    expect(await listTags("ghcr.io/example/platform", fetchFn)).toEqual(["1.0", "1.1", "2.0-alpha", "2.0", "2.1"]);
    // One token for all pages.
    expect(calls.filter((c) => c.includes("/token"))).toHaveLength(1);
  });

  it("fails on an unknown repository", async () => {
    await expect(listTags("ghcr.io/example/missing", fakeRegistry({}))).rejects.toThrow(/404/);
  });
});

describe("platform image", () => {
  let t: TestApp;
  let admin: string;

  beforeEach(async () => {
    t = await startApp({ ALGOS_DIR: mkdtempSync(join(tmpdir(), "ww-algos-")) });
    admin = await loginAs(t, "admin");
    algoId = undefined;
  });
  afterEach(async () => {
    await t.app.close();
  });

  const inject = (method: "GET" | "PUT" | "POST", url: string, payload?: Record<string, unknown>, cookie = admin) =>
    t.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  const platform = async () => (await inject("GET", "/platform")).json<{ platform?: { image: string } }>().platform;

  let algoId: number | undefined;
  async function createInstance(name: string, symbol: string): Promise<void> {
    algoId ??= (
      await t.app.inject({
        method: "POST",
        url: "/api/v1/algos?fileName=alpha.algo",
        headers: { cookie: admin, "content-type": "application/octet-stream" },
        payload: Buffer.from("alpha-v1"),
      })
    ).json<{ id: number }>().id;
    const account = await t.db
      .selectFrom("accounts")
      .select("id")
      .where("number", "=", "1111111")
      .executeTakeFirstOrThrow();
    const created = await inject("POST", "/managed-instances", {
      name,
      accountId: account.id,
      config: {
        algoId,
        symbol,
        period: "m5",
        parameters: { RiskPercent: 0.5, EntryMode: "Pullback" },
        attribution: { mode: "auto" },
      },
    });
    expect(created.statusCode).toBe(201);
    expect((await inject("POST", `/managed-instances/${name}/deploy`, { confirm: name })).statusCode).toBe(200);
  }
  const deployedImage = async (name: string) =>
    (await inject("GET", `/managed-instances/${name}`)).json<{ deployment?: { image?: string } }>().deployment?.image;

  it("shows the image in use, and versions only after a check", async () => {
    expect((await inject("GET", "/platform")).json()).toEqual({
      platform: { image: `${DEMO}:1.0.0`, repository: DEMO, versions: [] },
      wickwatch: { current: expect.any(String) as string },
      // The demo has no registry to ask.
      updateCheck: false,
    });
  });

  it("lets only admins pick another version, of the same repository only, and keeps it", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await inject("PUT", "/platform/image", { image: `${DEMO}:1.1.0` }, viewer)).statusCode).toBe(403);
    for (const image of [`other/${DEMO}:1.1.0`, `${DEMO}:latest`, DEMO]) {
      expect((await inject("PUT", "/platform/image", { image })).json()).toEqual({ error: "invalid_image" });
    }
    expect(await platform()).toMatchObject({ image: `${DEMO}:1.0.0` });

    const set = await inject("PUT", "/platform/image", { image: `${DEMO}:1.1.0` });
    expect(set.statusCode).toBe(200);
    expect(await platform()).toMatchObject({ image: `${DEMO}:1.1.0` });
    expect(t.adapters.broker.image?.()).toBe(`${DEMO}:1.1.0`);
    const log = await t.db
      .selectFrom("audit_log")
      .select(["target", "details"])
      .where("action", "=", "platform.image")
      .execute();
    expect(log).toEqual([{ target: `${DEMO}:1.1.0`, details: JSON.stringify({ ok: true, from: `${DEMO}:1.0.0` }) }]);

    // After a restart: the stored choice wins over the adapter's setting.
    t.adapters.broker.useImage?.(`${DEMO}:1.0.0`);
    await t.app.images.load();
    expect(t.adapters.broker.image?.()).toBe(`${DEMO}:1.1.0`);
  });

  it("keeps an instance on its image when its configuration is applied, and updates it on request", async () => {
    await createInstance("x1", "GER40");
    expect(await deployedImage("x1")).toBe(`${DEMO}:1.0.0`);
    await inject("PUT", "/platform/image", { image: `${DEMO}:1.1.0` });

    expect((await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1" })).statusCode).toBe(200);
    expect(await deployedImage("x1")).toBe(`${DEMO}:1.0.0`);

    const bad = await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1", image: "other/image:1.1.0" });
    expect(bad.json()).toEqual({ error: "invalid_image" });
    const update = await inject("POST", "/managed-instances/x1/deploy", { confirm: "x1", image: `${DEMO}:1.1.0` });
    expect(update.statusCode).toBe(200);
    expect(await deployedImage("x1")).toBe(`${DEMO}:1.1.0`);
    const row = await t.db.selectFrom("instances").select("image").where("name", "=", "x1").executeTakeFirstOrThrow();
    expect(row.image).toBe(`${DEMO}:1.1.0`);
  });

  it("updates all instances on another image, leaving those with an open position alone", async () => {
    await createInstance("x1", "GER40");
    await createInstance("x2", "US30");
    expect((await inject("POST", "/managed-instances/update-images", { confirm: "x" })).json()).toEqual({
      error: "confirmation_required",
    });
    const viewer = await loginAs(t, "viewer");
    expect((await inject("POST", "/managed-instances/update-images", { confirm: "all" }, viewer)).statusCode).toBe(403);

    // x1 holds a position.
    const real = t.app.overview.overview.bind(t.app.overview);
    vi.spyOn(t.app.overview, "overview").mockImplementation(async (...args) => {
      const loaded = await real(...args);
      return {
        ...loaded,
        instances: loaded.instances.map((i) => (i.name === "x1" ? { ...i, openPositions: 1 } : i)),
      };
    });

    await inject("PUT", "/platform/image", { image: `${DEMO}:1.1.0` });
    // The runtime fetches the image first; until then nothing is deployed.
    let fetched = () => {};
    const download = new Promise<void>((resolve) => (fetched = resolve));
    const prepare = vi.fn(() => download);
    t.adapters.runtime.prepareImage = prepare;

    const started = await inject("POST", "/managed-instances/update-images", { confirm: "all" });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ image: `${DEMO}:1.1.0`, running: true, pending: ["x1", "x2"] });
    expect((await inject("POST", "/managed-instances/update-images", { confirm: "all" })).json()).toEqual({
      error: "update_running",
    });
    const progress = async () =>
      (await inject("GET", "/managed-instances/update-images")).json<{
        rollout?: { running: boolean; updated: string[]; skipped: { name: string; reason: string }[] };
      }>().rollout;
    expect(await progress()).toMatchObject({ running: true, updated: [] });
    expect(await deployedImage("x2")).toBe(`${DEMO}:1.0.0`);

    fetched();
    await vi.waitFor(async () => {
      expect((await progress())?.running).toBe(false);
    });
    expect(prepare).toHaveBeenCalledWith(`${DEMO}:1.1.0`);
    expect(await progress()).toMatchObject({ updated: ["x2"], skipped: [{ name: "x1", reason: "open_position" }] });
    expect(await deployedImage("x1")).toBe(`${DEMO}:1.0.0`);
    expect(await deployedImage("x2")).toBe(`${DEMO}:1.1.0`);
    const log = await t.db
      .selectFrom("audit_log")
      .select("details")
      .where("action", "=", "instance.update_images")
      .execute();
    expect(log.map((l) => JSON.parse(l.details ?? "{}") as unknown)).toEqual([
      { updated: ["x2"], skipped: ["x1: open_position"] },
    ]);

    // Nothing left to do but the one held back.
    expect((await inject("POST", "/managed-instances/update-images", { confirm: "all" })).json()).toMatchObject({
      pending: ["x1"],
    });
    await vi.waitFor(async () => {
      expect((await progress())?.running).toBe(false);
    });
  });

  it("fetches a chosen image ahead and shows the download", async () => {
    let fetched = () => {};
    const download = new Promise<void>((resolve) => (fetched = resolve));
    t.adapters.runtime.prepareImage = vi.fn(() => download);
    await inject("PUT", "/platform/image", { image: `${DEMO}:1.1.0` });
    expect(await platform()).toMatchObject({ image: `${DEMO}:1.1.0`, download: "running" });
    fetched();
    await vi.waitFor(async () => {
      expect(await platform()).not.toHaveProperty("download");
    });

    t.adapters.runtime.prepareImage = vi.fn(() => Promise.reject(new Error("pull denied")));
    await inject("PUT", "/platform/image", { image: `${DEMO}:1.2.0` });
    await vi.waitFor(async () => {
      expect(await platform()).toMatchObject({ download: "failed" });
    });
  });

  it("tells about newer stable versions after a check, as info alerts", async () => {
    const registry = fakeRegistry({
      [`registry-1.docker.io/library/${DEMO}`]: ["1.0.0", "1.2.0", "2.0.0-alpha"],
      "ghcr.io/wickwatch/wickwatch": ["0.0.1", "99.0.0"],
    });
    const { Images } = await import("../src/services/images");
    const images = new Images({
      db: t.db,
      broker: t.adapters.broker,
      log: t.app.log,
      version: "0.8.7",
      check: true,
      fetch: registry,
    });
    expect(images.updates()).toEqual({});
    expect(await images.check()).toBe(true);
    expect(images.platform()).toMatchObject({ versions: ["1.2.0", "1.0.0"], latest: "1.2.0" });
    expect(images.updates()).toEqual({
      platform: { current: "1.0.0", latest: "1.2.0" },
      wickwatch: { current: "0.8.7", latest: "99.0.0" },
    });
    // A registry that does not answer: no versions, no alert.
    const failing = new Images({
      db: t.db,
      broker: t.adapters.broker,
      log: t.app.log,
      version: "0.8.7",
      check: true,
      fetch: async () => new Response("", { status: 503 }),
    });
    expect(await failing.check()).toBe(false);
    expect(failing.updates()).toEqual({});
  });
});
