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
  // Opened right before the first load of each test.
  openedAt: "2026-10-06T09:00:00.000Z",
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

  it("answers the first stop it saw on each position, also one set only after the opening", async () => {
    now = new Date(now.getTime() + 60_000);
    expect(await history.observe("1111111", [position({ sl: 90 }), position({}, "p2")])).toEqual(new Map([["p1", 90]]));
    await observe(position({ sl: 100 }), position({ sl: 95 }, "p2"));
    expect(await history.observe("1111111", [position({ sl: 110 }), position({ sl: 99 }, "p2")])).toEqual(
      new Map([
        ["p1", 90],
        ["p2", 95],
      ]),
    );
  });

  it("answers no stop for a position first seen well after its opening, nor for one the broker names it for", async () => {
    now = new Date(now.getTime() + 60_000);
    const late = position({ sl: 95, openedAt: "2026-10-06T08:00:00.000Z" });
    expect(await history.observe("1111111", [late, position({ sl: 90, initialStopLoss: 80 }, "p2")])).toEqual(
      new Map(),
    );
    // Watched from the opening, it keeps its stop also after a later restart.
    now = new Date(now.getTime() + 3 * 60 * 60_000);
    expect(await history.observe("1111111", [position({ sl: 90 }, "p2")])).toEqual(new Map([["p2", 90]]));
  });

  it("logs a failure instead of failing the load", async () => {
    await t.db.schema.dropTable("position_history").execute();
    await expect(history.observe("1111111", [position({ sl: 90 })])).resolves.toEqual(new Map());
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("PositionHistory.levels", () => {
  it("lists stop loss and take profit from the first answer on, and then at each change of either", async () => {
    await observe(position({ tp: 120 }));
    await observe(position({ sl: 90, tp: 120 }));
    await observe(position({ sl: 90, tp: 120, volume: 0.5 }));
    await observe(position({ sl: 100, tp: 120 }));
    await observe(position({ sl: 100 }), position({ sl: 50 }, "p2"));
    expect(await history.levels(accountId, "p1")).toEqual([
      { at: "2026-10-06T09:01:00.000Z", tp: 120 },
      { at: "2026-10-06T09:02:00.000Z", sl: 90, tp: 120 },
      { at: "2026-10-06T09:04:00.000Z", sl: 100, tp: 120 },
      { at: "2026-10-06T09:05:00.000Z", sl: 100 },
    ]);
    expect(await history.levels(accountId, "unknown")).toEqual([]);
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

describe("R of open positions", () => {
  it("measures against the first stop wickwatch saw once the stop moved, unless the broker names the initial one", async () => {
    const positions = vi.spyOn(t.adapters.broker, "positions");
    // The app runs on the real clock: opened just now, so wickwatch sees it from its opening.
    const openedAt = new Date().toISOString();
    const cookie = await loginAs(t, "viewer");
    const get = async (url: string) =>
      (await t.app.inject({ url: `/api/v1/${url}`, headers: { cookie } })).json<{ positions: unknown[] }>();

    positions.mockResolvedValue([position({ sl: 90, price: 105, pnl: 50, openedAt })]);
    await get("overview");
    // Stop moved to break even: still 1R is 10 points, so 15 points are 1.5R.
    positions.mockResolvedValue([position({ sl: 100, price: 115, pnl: 75, openedAt })]);
    expect((await get("instances/alpha-ger40-a")).positions).toEqual([
      expect.objectContaining({ id: "p1", sl: 100, initialStopLoss: 90, r: 1.5 }),
    ]);

    positions.mockResolvedValue([position({ sl: 100, initialStopLoss: 80, price: 115, pnl: 75, openedAt })]);
    expect((await get("instances/alpha-ger40-a")).positions).toEqual([
      expect.objectContaining({ initialStopLoss: 80, r: 0.75 }),
    ]);
    // The account page, from the overview loaded first.
    expect((await get("accounts/1111111/detail")).positions).toEqual([
      expect.objectContaining({ initialStopLoss: 90, r: 0.5 }),
    ]);
  });
});
