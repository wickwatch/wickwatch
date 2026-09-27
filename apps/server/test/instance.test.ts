import type { InstanceDetail, LogLine } from "@wickwatch/core";
import { Value } from "typebox/value";
import { InstanceDetail as InstanceDetailSchema } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
