import type { AccountDeals, InstanceDetail, LogLine } from "@wickwatch/core";
import { Value } from "typebox/value";
import { AccountDeals as AccountDealsSchema, InstanceDetail as InstanceDetailSchema } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginAs, startApp, type TestApp } from "./helpers";

let t: TestApp;
let admin: string;
beforeEach(async () => {
  t = await startApp();
  admin = await loginAs(t, "admin");
});
afterEach(async () => {
  await t.app.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const get = (url: string, cookie = admin) => t.app.inject({ url, headers: { cookie } });

describe("instance detail", () => {
  it("returns a schema-valid detail with this instance's data only", async () => {
    const res = await get("/api/v1/instances/alpha-ger40-a?days=7");
    expect(res.statusCode).toBe(200);
    const detail = res.json<InstanceDetail>();
    expect(Value.Errors(InstanceDetailSchema, detail)).toEqual([]);
    expect(detail.instance).toMatchObject({ name: "alpha-ger40-a", status: "running", symbol: "GER40" });
    expect(detail.account).toEqual({ number: "1111111", displayName: "Demo Prop A Challenge", currency: "USD" });
    expect(detail.positions.every((p) => p.label === "alpha-ger40-a")).toBe(true);
    expect(detail.deals.every((d) => d.label === "alpha-ger40-a")).toBe(true);
    expect(detail.stats.trades).toBe(detail.deals.filter((d) => d.pnl !== 0).length);
    expect(Date.parse(detail.range.to) - Date.parse(detail.range.from)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("knows the first deal before the range and shows everything since then on request", async () => {
    // The demo account has 400 days of deals; the older history loads in the background.
    await get("/api/v1/instances/alpha-ger40-a?days=7");
    await vi.waitFor(async () => {
      expect((await get("/api/v1/instances/alpha-ger40-a?days=7")).json<InstanceDetail>().firstTradeAt).toBeDefined();
    });
    const week = (await get("/api/v1/instances/alpha-ger40-a?days=7")).json<InstanceDetail>();
    const first = Date.parse(week.firstTradeAt ?? "");
    expect(Date.now() - first).toBeGreaterThan(300 * DAY_MS);

    const all = (await get("/api/v1/instances/alpha-ger40-a?all=true")).json<InstanceDetail>();
    expect(Value.Errors(InstanceDetailSchema, all)).toEqual([]);
    expect(all.range.from).toBe(week.firstTradeAt);
    expect(all.deals[0]?.time).toBe(week.firstTradeAt);
    expect(all.deals.length).toBeGreaterThan(week.deals.length);
    expect(new Set(all.deals.map((d) => d.id)).size).toBe(all.deals.length);
  });

  it("answers 404 for unknown instances and validates the range", async () => {
    expect((await get("/api/v1/instances/nope")).statusCode).toBe(404);
    expect((await get("/api/v1/instances/alpha-ger40-a?days=0")).statusCode).toBe(400);
  });
});

describe("live log stream", () => {
  it("sends history as SSE events with proxy-friendly headers, then ends when the client leaves", async () => {
    const address = await t.app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const res = await fetch(`${address}/api/v1/instances/alpha-ger40-a/logs/stream?tail=3`, {
      headers: { cookie: admin },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let text = "";
    const decoder = new TextDecoder();
    while ((text.match(/event: log/g) ?? []).length < 3) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    controller.abort();

    const lines = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]!) as LogLine);
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => typeof l.text === "string" && l.time.endsWith("Z"))).toBe(true);
  });

  it("needs a login and a known instance", async () => {
    expect((await t.app.inject("/api/v1/instances/alpha-ger40-a/logs/stream")).statusCode).toBe(401);
    expect((await get("/api/v1/instances/nope/logs/stream")).statusCode).toBe(404);
  });
});

describe("log download", () => {
  const download = (query = "", cookie = admin) => get(`/api/v1/instances/alpha-ger40-a/logs/download${query}`, cookie);
  const times = (body: string) =>
    body
      .trimEnd()
      .split("\n")
      .map((line) => Date.parse(line.slice(0, line.indexOf(" "))));

  it("sends the last 24 hours as a text file, one UTC time and text per line", async () => {
    const res = await download();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="alpha-ger40-a-\d{8}-\d{4}\.log"$/);
    expect(
      res.body
        .trimEnd()
        .split("\n")
        .every((line) => /^\d{4}-\d\d-\d\dT[\d:.]+Z \S/.test(line)),
    ).toBe(true);
    const day = times(res.body);
    expect(day.every((time) => time >= Date.now() - DAY_MS - 60_000)).toBe(true);
    // More than the live view's tail of 1000 lines would allow, the whole week.
    const week = times((await download("?period=7d")).body);
    expect(week.length).toBeGreaterThan(day.length);
    expect(week.length).toBeGreaterThan(1000);
  });

  it("is open to viewers like the live log, needs a login and a known instance", async () => {
    expect((await download("", await loginAs(t, "viewer"))).statusCode).toBe(200);
    expect((await t.app.inject("/api/v1/instances/alpha-ger40-a/logs/download")).statusCode).toBe(401);
    expect((await get("/api/v1/instances/nope/logs/download")).statusCode).toBe(404);
    expect((await download("?period=1y")).statusCode).toBe(400);
  });
});

describe("log search", () => {
  const search = (query: string, cookie = admin) => get(`/api/v1/instances/alpha-ger40-a/logs/search${query}`, cookie);

  it("searches the whole log of the period for a text, case ignored, and only the problems if asked", async () => {
    const week = (await search("?q=e&period=7d")).json<{
      lines: { text: string; level?: string }[];
      truncated: boolean;
    }>();
    expect(week.lines.length).toBeGreaterThan(0);
    expect(week.lines.length).toBeLessThanOrEqual(1000);
    const word = week.lines[0]?.text.split(/\s+/).find((w) => w.length > 3) ?? "e";
    const found = (await search(`?q=${encodeURIComponent(word.toUpperCase())}&period=7d`)).json<{
      lines: { text: string }[];
    }>();
    expect(found.lines.length).toBeGreaterThan(0);
    expect(found.lines.every((l) => l.text.toLowerCase().includes(word.toLowerCase()))).toBe(true);
    const problems = (await search("?q=e&filter=problems&period=7d")).json<{ lines: { level?: string }[] }>();
    expect(problems.lines.every((l) => l.level === "warn" || l.level === "error")).toBe(true);
  });

  it("is open to viewers, needs a text, a login and a known instance", async () => {
    expect((await search("?q=a", await loginAs(t, "viewer"))).statusCode).toBe(200);
    expect((await search("")).statusCode).toBe(400);
    expect((await t.app.inject("/api/v1/instances/alpha-ger40-a/logs/search?q=a")).statusCode).toBe(401);
    expect((await get("/api/v1/instances/nope/logs/search?q=a")).statusCode).toBe(404);
  });
});

describe("close position", () => {
  const close = (id: string, confirm: string, cookie = admin) =>
    t.app.inject({
      method: "POST",
      url: `/api/v1/accounts/1111111/positions/${id}/close`,
      headers: { cookie },
      payload: { confirm },
    });

  it("closes a position after confirmation and audits it", async () => {
    const [position] = (await get("/api/v1/instances/alpha-ger40-a")).json<InstanceDetail>().positions;
    expect(position).toBeDefined();
    expect((await close(position!.id, "yes")).json()).toEqual({ error: "confirmation_required" });
    expect((await close(position!.id, position!.id)).statusCode).toBe(204);
    expect((await get("/api/v1/instances/alpha-ger40-a")).json<InstanceDetail>().positions).toEqual([]);

    const row = await t.db
      .selectFrom("audit_log")
      .select(["action", "target"])
      .where("action", "=", "position.close")
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ action: "position.close", target: `1111111/${position!.id}` });
  });

  it("is admin-only and answers 404 for unknown positions", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await close("x", "x", viewer)).statusCode).toBe(403);
    expect((await close("unknown", "unknown")).statusCode).toBe(404);
  });
});

describe("manual attribution", () => {
  const set = (positionId: string, instance: string | null, cookie = admin) =>
    t.app.inject({
      method: "PUT",
      url: `/api/v1/accounts/1111111/positions/${positionId}/attribution`,
      headers: { cookie },
      payload: { instance },
    });

  it("removes a position from an instance, lists it as excluded and restores it", async () => {
    const [position] = (await get("/api/v1/instances/alpha-ger40-a")).json<InstanceDetail>().positions;
    expect(position).toBeDefined();
    expect((await set(position!.id, null)).statusCode).toBe(204);

    const excluded = (await get("/api/v1/instances/alpha-ger40-a")).json<InstanceDetail>();
    expect(excluded.positions).toEqual([]);
    expect(excluded.excludedPositions.map((p) => p.id)).toEqual([position!.id]);

    const restore = await t.app.inject({
      method: "DELETE",
      url: `/api/v1/accounts/1111111/positions/${position!.id}/attribution`,
      headers: { cookie: admin },
    });
    expect(restore.statusCode).toBe(204);
    const restored = (await get("/api/v1/instances/alpha-ger40-a")).json<InstanceDetail>();
    expect(restored.positions.map((p) => p.id)).toEqual([position!.id]);

    const actions = await t.db
      .selectFrom("audit_log")
      .select("action")
      .where("action", "like", "attribution.%")
      .execute();
    expect(actions.map((a) => a.action)).toEqual(["attribution.set", "attribution.clear"]);
  });

  it("lists the account's deals with their instance and moves one to another instance by hand", async () => {
    const res = await get("/api/v1/accounts/1111111/deals?days=7");
    expect(res.statusCode).toBe(200);
    const listed = res.json<AccountDeals>();
    expect(Value.Errors(AccountDealsSchema, listed)).toEqual([]);
    expect(Date.parse(listed.range.to) - Date.parse(listed.range.from)).toBe(7 * DAY_MS);
    expect(listed.deals.map((d) => d.time)).toEqual(listed.deals.map((d) => d.time).sort());
    const deal = listed.deals.find((d) => d.instance === "alpha-ger40-a");
    expect(deal).toBeDefined();
    expect(deal!.manual).toBeUndefined();

    expect((await set(deal!.positionId, "beta-nas100-a")).statusCode).toBe(204);
    const moved = (await get("/api/v1/accounts/1111111/deals?days=7"))
      .json<AccountDeals>()
      .deals.filter((d) => d.positionId === deal!.positionId);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((d) => d.instance === "beta-nas100-a" && d.manual === true)).toBe(true);
    const ids = (ref: string) => get(`/api/v1/instances/${ref}?days=7`).then((r) => r.json<InstanceDetail>());
    expect((await ids("beta-nas100-a")).deals.map((d) => d.id)).toContain(deal!.id);
    const from = await ids("alpha-ger40-a");
    expect(from.deals.map((d) => d.id)).not.toContain(deal!.id);
    expect(from.excludedDeals.map((d) => d.id)).toContain(deal!.id);
  });

  it("answers 404 for the deals of an unknown account and validates the range", async () => {
    expect((await get("/api/v1/accounts/999/deals")).statusCode).toBe(404);
    expect((await get("/api/v1/accounts/1111111/deals?days=91")).statusCode).toBe(400);
  });

  it("is admin-only and needs a known account", async () => {
    const viewer = await loginAs(t, "viewer");
    expect((await set("x", null, viewer)).statusCode).toBe(403);
    expect((await set("x", null)).statusCode).toBe(204);
    const unknown = await t.app.inject({
      method: "PUT",
      url: "/api/v1/accounts/999/positions/x/attribution",
      headers: { cookie: admin },
      payload: { instance: null },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
