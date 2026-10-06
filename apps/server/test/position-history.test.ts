import type { Position } from "@wickwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbAccountDirectory } from "../src/accounts";
import { PositionHistory } from "../src/services/position-history";
import { loginAs, startApp, type TestApp } from "./helpers";

const position = (values: Partial<Position>, id = "p1"): Position => ({
  id,
  symbol: "GER40",
  side: "buy",
  volume: 1,
  entry: 100,
  pnl: 0,
  openedAt: "2026-10-06T06:00:00.000Z",
  ...values,
});

let t: TestApp;
let accountId: number;
let history: PositionHistory;
let now: Date;
let log: { warn: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  t = await startApp();
  ({ id: accountId } = await t.db
    .selectFrom("accounts")
    .select("id")
    .where("number", "=", "1111111")
    .executeTakeFirstOrThrow());
  now = new Date("2026-10-06T09:00:00.000Z");
  log = { warn: vi.fn() };
  history = new PositionHistory({
    db: t.db,
    accounts: dbAccountDirectory(t.db, t.cipher, "demo"),
    log: log as never,
    now: () => now,
  });
});
afterEach(async () => {
  await t.app.close();
});

/** One load a minute later. */
async function observe(...positions: Position[]) {
  now = new Date(now.getTime() + 60_000);
  await history.observe("1111111", positions);
}

describe("PositionHistory", () => {
  it("notes a moved stop loss and take profit with the time it noticed them", async () => {
    await observe(position({ sl: 90, tp: 120 }));
    expect(await history.changes(accountId, "p1")).toEqual([]);

    await observe(position({ sl: 90, tp: 120 }));
    await observe(position({ sl: 100, tp: 120 }));
    await observe(position({ sl: 100, tp: 120 }));
    await observe(position({ sl: 100, tp: 150 }));
    expect(await history.changes(accountId, "p1")).toEqual([
      { at: "2026-10-06T09:03:00.000Z", field: "sl", from: 90, to: 100 },
      { at: "2026-10-06T09:05:00.000Z", field: "tp", from: 120, to: 150 },
    ]);
    // A row for the first sight and one per change, none for the loads in between.
    const rows = await t.db.selectFrom("position_history").select("id").execute();
    expect(rows).toHaveLength(3);
  });

  it("notes a stop loss or take profit set later or removed, and two changes in one answer", async () => {
    await observe(position({ tp: 120 }));
    await observe(position({ sl: 95 }));
    expect(await history.changes(accountId, "p1")).toEqual([
      { at: "2026-10-06T09:02:00.000Z", field: "sl", to: 95 },
      { at: "2026-10-06T09:02:00.000Z", field: "tp", from: 120 },
    ]);
  });

  it("notes a partial close, and added volume with the entry price it moves", async () => {
    await observe(position({ sl: 90, volume: 2 }));
    await observe(position({ sl: 90, volume: 1 }));
    await observe(position({ sl: 90, volume: 1.5, entry: 102 }));
    expect(await history.changes(accountId, "p1")).toEqual([
      { at: "2026-10-06T09:02:00.000Z", field: "volume", from: 2, to: 1 },
      { at: "2026-10-06T09:03:00.000Z", field: "volume", from: 1, to: 1.5 },
      { at: "2026-10-06T09:03:00.000Z", field: "entry", from: 100, to: 102 },
    ]);
  });

  it("keeps positions and accounts apart", async () => {
    const other = await t.db
      .selectFrom("accounts")
      .select("id")
      .where("number", "=", "2222222")
      .executeTakeFirstOrThrow();
    await observe(position({ sl: 90 }), position({ sl: 50 }, "p2"));
    await history.observe("2222222", [position({ sl: 10 })]);
    await observe(position({ sl: 90 }), position({ sl: 60 }, "p2"));
    expect(await history.changes(accountId, "p1")).toEqual([]);
    expect(await history.changes(other.id, "p1")).toEqual([]);
    expect(await history.changes(accountId, "p2")).toHaveLength(1);
  });

  it("notes a change once when two loads answer at the same time", async () => {
    await observe(position({ sl: 90 }));
    await Promise.all([
      history.observe("1111111", [position({ sl: 100 })]),
      history.observe("1111111", [position({ sl: 100 })]),
    ]);
    expect(await history.changes(accountId, "p1")).toHaveLength(1);
  });

  it("logs a failure instead of failing the load", async () => {
    await t.db.schema.dropTable("position_history").execute();
    await expect(history.observe("1111111", [position({ sl: 90 })])).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("GET /accounts/:number/positions/:positionId/changes", () => {
  it("returns what the answers of the broker showed, whoever asked, also to a viewer", async () => {
    const positions = vi.spyOn(t.adapters.broker, "positions");
    const cookie = await loginAs(t, "viewer");
    const get = (url: string) => t.app.inject({ url: `/api/v1/${url}`, headers: { cookie } });

    positions.mockResolvedValue([position({ sl: 90, tp: 120 })]);
    await get("overview");
    positions.mockResolvedValue([position({ sl: 100, tp: 120 })]);
    expect((await get("instances/alpha-ger40-a")).statusCode).toBe(200);

    const res = await get("accounts/1111111/positions/p1/changes");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ at: expect.any(String) as string, field: "sl", from: 90, to: 100 }]);
    expect((await get("accounts/1111111/positions/unknown/changes")).json()).toEqual([]);
    expect((await get("accounts/9999999/positions/p1/changes")).statusCode).toBe(404);
  });

  it("needs a login", async () => {
    expect((await t.app.inject({ url: "/api/v1/accounts/1111111/positions/p1/changes" })).statusCode).toBe(401);
  });
});
