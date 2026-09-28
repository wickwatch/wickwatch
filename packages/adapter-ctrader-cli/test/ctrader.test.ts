import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeBrokerAdapter } from "@wickwatch/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliError, CtraderCliBroker, DEFAULT_CTRADER_IMAGE, extractJson, toLogEvent, toRunArguments } from "../src";

const FAKE = join(__dirname, "fake-cli.mjs");
const c = { login: "user@example.com", secret: "correct horse" };
let log: string;
let broker: CtraderCliBroker;

const create = () =>
  new CtraderCliBroker({
    binary: process.execPath,
    binaryArgs: [FAKE],
    commandTimeoutMs: 5000,
    connectTimeoutMs: 5000,
  });

beforeEach(() => {
  log = join(mkdtempSync(join(tmpdir(), "ww-fake-")), "calls.log");
  writeFileSync(log, "");
  process.env["FAKE_CTRADER_LOG"] = log;
  broker = create();
});
afterEach(async () => {
  await broker.dispose();
});

const calls = () =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[]);

describeBrokerAdapter("ctrader-cli (fake CLI)", {
  setup: () => {
    broker = create();
    return broker;
  },
  credentials: c,
  account: "1111111",
  invalidCredentials: { login: "user@example.com", secret: "wrong" },
  algoPath: "/algos/bot.algo",
  // Safe: the fake CLI trades nothing.
  destructive: true,
});

describe("CtraderCliBroker", () => {
  it("lists accounts with active flag and broker name", async () => {
    expect(await broker.accounts(c)).toEqual([
      { number: "1111111", broker: "Demo Broker", currency: "USD", live: false, active: true, name: "Challenge A" },
      { number: "2222222", broker: "Demo Broker", currency: "EUR", live: true, active: true },
      { number: "5555555", broker: "Demo Broker", currency: "USD", live: false, active: false },
    ]);
  });

  it("reads balance, equity, positions and pending orders through one shell session", async () => {
    expect(await broker.stats(c, "1111111")).toMatchObject({
      balance: 10138.66,
      equity: 10090.5,
      margin: 120,
      freeMargin: 9970.5,
    });
    expect(await broker.positions(c, "1111111")).toEqual([
      {
        id: "31",
        symbol: "US100.cash",
        side: "buy",
        volume: 0.5,
        entry: 29400,
        pnl: -48.2,
        sl: 29300,
        label: "123456789",
        openedAt: "2026-09-25T08:00:00.000Z",
      },
    ]);
    expect(await broker.pendingOrders(c, "1111111")).toEqual([
      { id: "41", symbol: "US100.cash", type: "limit", side: "sell", volume: 0.5, price: 29800, sl: 29900, tp: 29600 },
    ]);
    const shells = calls().filter((a) => !["accounts", "symbols", "metadata"].includes(a[0] ?? ""));
    expect(shells).toHaveLength(1);
  });

  it("warms the session up, so the first deals query is not empty; asks one day more and filters", async () => {
    const deals = await broker.deals(c, "1111111", "2026-09-23T00:00:00.000Z", "2026-09-25T08:59:59.000Z");
    expect(deals).toEqual([
      {
        id: "11",
        positionId: "21",
        symbol: "US100.cash",
        side: "buy",
        volume: 0.62,
        price: 29293.43,
        pnl: 49.1,
        commission: -1.5,
        swap: 0,
        label: "123456789",
        time: "2026-09-23T13:40:39.746Z",
      },
    ]);
  });

  it("never passes the password as an argument", async () => {
    await broker.accounts(c);
    await broker.stats(c, "1111111");
    const all = calls().flat();
    expect(all.some((a) => a.includes("correct horse"))).toBe(false);
    expect(all.some((a) => a.startsWith("--pwd-file="))).toBe(true);
    expect(all.some((a) => a.startsWith("--password"))).toBe(false);
  });

  it("maps metadata: enum defaults by name, build time, friendly names and groups", async () => {
    const metadata = await broker.algoMetadata("/algos/bot.algo");
    expect(metadata).toEqual({
      name: "SampleBot",
      fullAccess: false,
      buildTime: "2026-09-18T13:33:03.586Z",
      parameters: [
        { name: "Start", type: "string", label: "Session start", group: "Session", default: "15:30" },
        { name: "Period", type: "int", label: "ATR period", group: "Signal", default: 14, min: 5, max: 50 },
        { name: "Mode", type: "enum", label: "Mode", group: "Signal", default: "Slow", options: ["Fast", "Slow"] },
        { name: "UseFilter", type: "bool", group: "Filter", default: false },
      ],
    });
    await expect(broker.algoMetadata("/algos/missing.txt")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("reports unknown, closed accounts and wrong passwords with adapter codes", async () => {
    await expect(broker.stats(c, "9999999")).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.stats(c, "5555555")).rejects.toMatchObject({ code: "unavailable" });
    await expect(broker.stats(c, "5555555")).rejects.toThrow(/not active/);
    await expect(broker.stats({ ...c, secret: "wrong" }, "1111111")).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("reads pending orders in the recorded format", async () => {
    expect(await broker.pendingOrders(c, "1111111")).toEqual([
      { id: "41", symbol: "US100.cash", type: "limit", side: "sell", volume: 0.5, price: 29800, sl: 29900, tp: 29600 },
    ]);
  });

  it("cancels an order and closes a position in the account's shell, and checks they are gone", async () => {
    await broker.cancelOrder(c, "1111111", "41");
    await broker.closePosition(c, "1111111", "31");
    expect(await broker.pendingOrders(c, "1111111")).toEqual([]);
    expect(await broker.positions(c, "1111111")).toEqual([]);
    // One session for all of it.
    expect(calls().filter((a) => !["accounts", "symbols", "metadata"].includes(a[0] ?? ""))).toHaveLength(1);
  });

  it("reports unknown ids and ids that could inject shell commands as not found", async () => {
    await expect(broker.cancelOrder(c, "1111111", "99")).rejects.toMatchObject({ code: "not_found" });
    await expect(broker.closePosition(c, "1111111", "31 yes\nposition close all")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await broker.positions(c, "1111111")).toHaveLength(1);
  });

  it("cancels orders before closing positions in the emergency stop", async () => {
    expect(broker.capabilities()).toMatchObject({ emergencyStop: true, pendingOrders: true });
    expect(await broker.emergencyStop(c, "1111111")).toEqual({ closed: 1, cancelled: 1 });
  });

  it("does not report success when the broker kept the order or position", async () => {
    process.env["FAKE_CTRADER_STUCK"] = "1";
    try {
      const stuck = create();
      await expect(stuck.cancelOrder(c, "1111111", "41")).rejects.toThrow(/still pending/);
      await expect(stuck.emergencyStop(c, "1111111")).rejects.toThrow(/1 positions, 1 orders/);
      await stuck.dispose();
    } finally {
      delete process.env["FAKE_CTRADER_STUCK"];
    }
  });

  it("launches `run` in the pinned image with password and algo as files, never as arguments", async () => {
    const algo = new TextEncoder().encode("algo-bytes");
    const launch = await broker.launch({
      credentials: c,
      account: "1111111",
      algo: { name: "Sample Bot", file: algo, fullAccess: true },
      symbol: "US100.cash",
      period: "m5",
      parameters: { Period: 14, Mode: "Slow", UseFilter: false, Start: "15:30", Risk: 0.5 },
    });
    expect(launch.image).toBe(DEFAULT_CTRADER_IMAGE);
    expect(launch.command).toEqual([
      "run",
      "/mnt/wickwatch/Sample-Bot.algo",
      "--ctid=user@example.com",
      "--pwd-file=/mnt/wickwatch/ctid.pwd",
      "--account=1111111",
      "--symbol=US100.cash",
      "--period=m5",
      "--exit-on-stop",
      "--full-access",
      "--Period=14",
      "--Mode=Slow",
      "--UseFilter=false",
      "--Start=15:30",
      "--Risk=0.5",
    ]);
    expect(launch.command.join(" ")).not.toContain("correct horse");
    expect(launch.files.map((f) => [f.path, f.mode])).toEqual([
      ["/mnt/wickwatch/Sample-Bot.algo", 0o444],
      ["/mnt/wickwatch/ctid.pwd", 0o400],
    ]);
    expect(new TextDecoder().decode(launch.files[1]?.content)).toBe("correct horse");
    expect(
      (
        await new CtraderCliBroker({ image: "example/ctrader:1.0" }).launch({
          credentials: c,
          account: "1",
          algo: { name: "a", file: algo, fullAccess: false },
          symbol: "X",
          period: "h1",
          parameters: {},
        })
      ).command,
    ).not.toContain("--full-access");
  });

  it("rejects parameter names and values that could smuggle in other options", () => {
    expect(() => toRunArguments({ "account=2 --x": 1 })).toThrow(/name/);
    expect(() => toRunArguments({ Note: "a\nb" })).toThrow(/value/);
    expect(() => toRunArguments({ Obj: { a: 1 } })).toThrow(/value/);
    expect(toRunArguments({ Note: "" })).toEqual(["--Note="]);
  });

  it("formats values the way the CLI parses them", () => {
    // Verified with ctrader-console 5.9.11: invalid values (e.g. "2,5" or "1" for a bool) silently fall
    // back to the default, and the startup table still shows the given value. So the format must be right.
    expect(
      toRunArguments({ Risk: 0.25, Tiny: 0.0000001, Huge: 1e21, Flag: true, Mode: "Gamma", Time: "09:05" }),
    ).toEqual(["--Risk=0.25", "--Tiny=1e-7", "--Huge=1e+21", "--Flag=true", "--Mode=Gamma", "--Time=09:05"]);
  });

  it("starts a new session after the old one died", async () => {
    await broker.stats(c, "1111111");
    await broker.dispose();
    expect(await broker.stats(c, "1111111")).toMatchObject({ balance: 10138.66 });
  });
});

describe("helpers", () => {
  it("finds the JSON after status lines, skipping the bracketed echo line", () => {
    const output = '[2026-09-27 17:11:23 +02:00] accounts\n\n{\n  "accounts": [{ "a": "} ] \\" x" }]\n}\n\n> ';
    expect(extractJson(output)).toEqual({ accounts: [{ a: '} ] " x' }] });
    expect(extractJson('ctrader-cli accounts\n[\n  { "Id": 1 }\n]\n')).toEqual([{ Id: 1 }]);
    expect(() => extractJson("Logged in.\n")).toThrow(/no JSON/);
  });

  it("translates CLI messages", () => {
    expect(cliError("Logged in.\nAccount 1 is not linked to this cTID.").code).toBe("not_found");
    expect(cliError("Error: Symbol not found: X").code).toBe("not_found");
    expect(cliError("Missing --ctid in non-interactive mode.").code).toBe("invalid_input");
    expect(cliError("Connecting as a...\nInvalid credentials.").code).toBe("auth_failed");
  });

  it("recognises connection events in the run output, but not in the cBot's own lines", () => {
    // Recorded with ctrader-console 5.9.11 while the container was cut off from the network.
    expect(toLogEvent("28/09/2026 16:34:50.272 | The connection has been lost. Reconnecting...")).toBe(
      "connection_lost",
    );
    expect(toLogEvent("28/09/2026 16:35:18.318 | The connection has been restored.")).toBe("connection_restored");
    expect(toLogEvent("28/09/2026 16:33:33.537 | The connection has been established.")).toBe("connection_restored");
    expect(toLogEvent("28/09/2026 16:34:51.374 | Info | The connection has been lost")).toBeUndefined();
    expect(toLogEvent("28/09/2026 16:33:36.356 | Info | WW-PROBE positions=0 pending=0")).toBeUndefined();
    expect(
      toLogEvent(
        "28/09/2026 16:29:01.899 | Error | Crashed in Timer.TimerTick event with InvalidOperationException: WW-PROBE deliberate crash",
      ),
    ).toBe("algo_crashed");
    expect(
      toLogEvent("28/09/2026 16:29:01.899 | Info | Crashed in OnBar event with X: printed by the bot"),
    ).toBeUndefined();
    expect(new CtraderCliBroker().logEvent("The connection has been lost. Reconnecting...")).toBe("connection_lost");
  });
});
