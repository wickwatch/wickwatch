// Stand-in for ctrader-cli 5.9 in tests: same status lines, prompt and JSON shapes as the real CLI.
// Accounts: 1111111 (active), 2222222 (active), 5555555 (closed). Password "wrong" fails the login.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith("-"));
if (process.env.FAKE_CTRADER_LOG) appendFileSync(process.env.FAKE_CTRADER_LOG, JSON.stringify(args) + "\n");

const out = (s) => process.stdout.write(s);
const stamp = () => "[2026-09-25 12:00:00 +02:00]";
const accounts = [
  {
    Id: 1,
    Number: 1111111,
    Broker: "Demo Broker",
    Live: false,
    DepositCurrency: "USD",
    Leverage: 100,
    Balance: 10138.66,
  },
  { Id: 2, Number: 2222222, Broker: "Demo Broker", Live: true, DepositCurrency: "EUR", Leverage: 30, Balance: 5000 },
  {
    Id: 3,
    Number: 5555555,
    Broker: "Demo Broker",
    Live: false,
    DepositCurrency: "USD",
    Leverage: 100,
    Balance: 8988.33,
  },
];
const active = [
  {
    traderLogin: 1111111,
    brokerName: "Demo Broker",
    environment: "demo",
    accountName: "Challenge A",
    accountStatus: "Active",
  },
  { traderLogin: 2222222, brokerName: "Demo Broker", environment: "live", accountName: null, accountStatus: "Active" },
];
// Like the real CLI, a shell lists the active accounts as of its login. FAKE_CTRADER_ALSO_ACTIVE (numbers,
// comma-separated) stands for accounts that became active since, e.g. a new challenge.
for (const number of process.env.FAKE_CTRADER_ALSO_ACTIVE?.split(",") ?? []) {
  active.push({ traderLogin: Number(number), brokerName: "Demo Broker", environment: "demo", accountStatus: "Active" });
}
const historyOrders = [
  {
    id: 31,
    symbolName: "US100.cash",
    tradeSide: "Buy",
    orderType: "Limit",
    status: "Filled",
    executionPrice: 29214.23,
    stopLoss: 29164.23,
    takeProfit: 29293.43,
    positionId: 21,
    openTime: "2026-09-23T09:00:00.000Z",
    closeTime: "2026-09-23T09:12:00.000Z",
  },
  {
    id: 32,
    symbolName: "US100.cash",
    tradeSide: "Sell",
    orderType: "StopLossTakeProfit",
    status: "Filled",
    targetPrice: 29293.43,
    stopLoss: null,
    positionId: 21,
    openTime: "2026-09-23T13:40:39.000Z",
  },
];

const deals = [
  {
    orderId: 11,
    positionId: 21,
    symbolName: "US100.cash",
    dealType: "Limit",
    side: "Buy",
    filledVolume: 0.62,
    filledVolumeLots: 0.62,
    executionPrice: 29293.43,
    entryPrice: 29214.23,
    pips: 79.2,
    grossProfit: 49.1,
    commission: -1.5,
    swap: 0,
    netProfit: 47.6,
    label: "123456789",
    comment: "",
    time: "2026-09-23T13:40:39.746Z",
  },
  {
    orderId: 12,
    positionId: 22,
    symbolName: "US100.cash",
    dealType: "Market",
    side: "Sell",
    filledVolume: 1,
    filledVolumeLots: 1,
    executionPrice: 29500,
    entryPrice: 29550,
    pips: 50,
    grossProfit: 50,
    commission: 0,
    swap: -0.2,
    netProfit: 49.8,
    label: "",
    comment: "",
    time: "2026-09-25T09:00:00.000Z",
  },
];

function login() {
  const password = flag("pwd-file") ? readFileSync(flag("pwd-file"), "utf8") : flag("password");
  out(`cTrader CLI\n\nConnecting as ${flag("ctid")}...\n`);
  if (password === "wrong") {
    out("Invalid credentials.\n");
    process.exit(1);
  }
  out("Logged in.\n\n");
}

function json(value) {
  out(`${JSON.stringify(value, null, 2)}\n`);
}

const command = positional[0];
if (command === "accounts" || command === "symbols") {
  out(`ctrader-cli ${args.join(" ")}\n`);
  login();
  if (command === "accounts") json(accounts);
  else
    json([
      { Id: 1, Name: "US100.cash", Description: "US Tech 100" },
      { Id: 2, Name: "EURUSD", Description: "Euro vs US Dollar" },
    ]);
  process.exit(0);
}
if (command === "metadata") {
  out(`ctrader-cli ${args.join(" ")}\n`);
  if (!positional[1]?.endsWith("bot.algo")) {
    out(`Unable to determine destination for argument value: ${positional[1]}\n`);
    process.exit(1);
  }
  json({
    Name: "SampleBot",
    Type: "cBot",
    AccessRights: "None",
    BuildTime: "2026-09-18T13:33:03.5861660Z",
    Parameters: [
      {
        PropertyName: "Start",
        FriendlyName: "Session start",
        GroupName: "Session",
        Type: "String",
        DefaultValue: "15:30",
      },
      {
        PropertyName: "Period",
        FriendlyName: "ATR period",
        GroupName: "Signal",
        Type: "Integer",
        DefaultValue: 14,
        MinValue: 5,
        MaxValue: 50,
      },
      {
        PropertyName: "Mode",
        FriendlyName: "Mode",
        GroupName: "Signal",
        Type: "Enum",
        DefaultValue: 1,
        EnumValues: { Fast: 0, Slow: 1 },
      },
      { PropertyName: "UseFilter", GroupName: "Filter", Type: "Boolean", DefaultValue: false },
      { PropertyName: "LineColor", GroupName: "Chart", Type: "Color", DefaultValue: { A: 128, R: 255, G: 0, B: 10 } },
    ],
  });
  process.exit(0);
}

// Interactive shell.
login();
const account = flag("account");
if (account === "5555555") {
  out(
    `Account ${account} (Demo Broker) is not available on this cTrader build. Use the cTrader CLI installed for that broker.\n`,
  );
  process.exit(1);
}
if (!accounts.some((a) => String(a.Number) === account)) {
  out(`Account ${account} is not linked to this cTID.\n`);
  process.exit(1);
}
out(
  `Using account: #${account} Demo Broker USD 10138.66 demo\n\nConnecting to Demo Broker...\nConnected as ${flag("ctid")} on #${account}.\n\n│ Commands:\n│  1) accounts\n> `,
);

// Stateful per session, so cancelling and closing can be checked. FAKE_CTRADER_STUCK keeps them open.
// Field names as recorded from ctrader-console 5.9 on 2026-09-28 (a Sell on ETHUSD).
let positions = [
  {
    id: 31,
    symbolName: "US100.cash",
    tradeSide: "Buy",
    volume: 0.5,
    volumeLots: 0.5,
    entryPrice: 29400,
    currentPrice: 29303.6,
    pips: -96.4,
    grossProfit: -48.2,
    netProfit: -48.2,
    swap: 0,
    commission: 0,
    stopLoss: 29300,
    stopLossPips: null,
    takeProfit: null,
    takeProfitPips: null,
    openTime: "2026-09-25T08:00:00.000Z",
    label: "123456789",
    comment: "",
  },
];
// Like the real CLI, the first listing of a session has no prices; FAKE_CTRADER_NO_PRICES keeps it so.
let priced = false;
const unpriced = (p) => ({ ...p, currentPrice: null, pips: null, grossProfit: null, netProfit: null });
// Field names as recorded from ctrader-console 5.9 on 2026-09-28 (a Buy Stop on EURUSD).
let orders = [
  {
    id: 41,
    symbolName: "US100.cash",
    tradeSide: "Sell",
    orderType: "Limit",
    volume: 50,
    volumeLots: 0.5,
    targetPrice: 29800,
    limitPrice: null,
    slippagePips: null,
    currentPrice: null,
    stopLoss: 29900,
    stopLossPips: null,
    takeProfit: 29600,
    takeProfitPips: null,
    expiration: "2026-10-02T21:00:00.000Z",
    label: "",
    comment: "",
  },
];
const stuck = Boolean(process.env.FAKE_CTRADER_STUCK);
/** `order cancel <id|all> yes`, `position close <id|all> yes`. */
function remove(kind, list, idKey, target) {
  if (target !== "all" && !list.some((i) => String(i[idKey]) === target)) {
    out(`Error: ${kind} not found: ${target}\n`);
    return list;
  }
  out(`${kind === "Order" ? "Cancelled" : "Closed"} ${target === "all" ? String(list.length) : "1"}.\n`);
  if (stuck) return list;
  return target === "all" ? [] : list.filter((i) => String(i[idKey]) !== target);
}

let warm = false;
createInterface({ input: process.stdin }).on("line", (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (cmd === "q") {
    out("Bye.\n");
    process.exit(1);
  }
  out(`${stamp()} ${line.trim()}\n\n`);
  const history = cmd === "deals" || cmd === "orders-history";
  const empty = history && !warm;
  if (history) warm = true;
  if (cmd === "account")
    json({
      isCurrent: true,
      balance: 10138.66,
      equity: 10090.5,
      margin: 120,
      freeMargin: 9970.5,
      marginLevel: 8408,
      accountName: "Challenge A",
    });
  else if (cmd === "accounts") json({ accounts: active });
  else if (cmd === "positions") {
    json({ positions: priced && !process.env.FAKE_CTRADER_NO_PRICES ? positions : positions.map(unpriced) });
    priced = true;
  } else if (cmd === "orders") json({ orders });
  else if (cmd === "order" && rest[0] === "cancel" && rest.at(-1) === "yes")
    orders = remove("Order", orders, "id", rest[1]);
  else if (cmd === "position" && rest[0] === "close" && rest.at(-1) === "yes")
    positions = remove("Position", positions, "id", rest[1]);
  else if (cmd === "deals")
    json(
      empty
        ? { from: rest[0], to: rest[1], deals: [], count: 0 }
        : { from: rest[0], to: rest[1], deals, count: deals.length },
    );
  else if (cmd === "orders-history")
    json(
      // Warm-up with a count, then a date range: the order that opened position 21 (with its stop) and the one
      // that closed it (stop/take-profit, to be ignored).
      rest.length === 2 && !empty
        ? { from: rest[0], to: rest[1], orders: historyOrders }
        : { requested: 1, returned: 0, available: 0, lookbackDays: 30, orders: [] },
    );
  else if (cmd === "sessions" && rest[0] === "BTCUSD")
    json({ symbolName: "BTCUSD", timeZone: "Russian Standard Time", marketIsAlwaysOpen: true, sessions: [] });
  else if (cmd === "sessions" && rest[0] === "US30.cash")
    // As recorded at FTMO (5.9.11): Mon–Fri 01:05–23:50 Moscow time, seconds from Sunday 00:00 there.
    json({
      symbolName: "US30.cash",
      timeZone: "Russian Standard Time",
      marketIsAlwaysOpen: false,
      sessions: [1, 2, 3, 4, 5].map((d) => ({
        start: `${["Mon", "Tue", "Wed", "Thu", "Fri"][d - 1]} 01:05:00`,
        end: `${["Mon", "Tue", "Wed", "Thu", "Fri"][d - 1]} 23:50:00`,
        startSecond: d * 86400 + 3900,
        endSecond: d * 86400 + 85800,
      })),
    });
  else if (cmd === "symbol" || cmd === "sessions") out(`Error: Symbol not found: ${rest[0]}\n`);
  else out(`Error: Unknown command: ${cmd}\n`);
  out("\n> ");
});
