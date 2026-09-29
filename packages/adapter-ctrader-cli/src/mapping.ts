import {
  AdapterError,
  type AccountStats,
  type AlgoMetadata,
  type BrokerAccount,
  type Deal,
  type LogEvent,
  type ParameterSchema,
  type ParameterValues,
  type PendingOrder,
  type Position,
} from "@wickwatch/core";

// Translations from cTrader CLI JSON (5.9) to the neutral core types. Field names follow
// the outputs recorded in the private planning notes; anything unexpected is rejected
// instead of guessed, so the dashboard never shows made-up numbers.

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const isoTime = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const side = (v: unknown) => {
  const s = str(v)?.toLowerCase();
  return s === "buy" || s === "sell" ? s : undefined;
};
const optional = <K extends string, V>(key: K, value: V | undefined | null): Partial<Record<K, V>> =>
  value === undefined || value === null ? {} : ({ [key]: value } as Record<K, V>);

function list(data: unknown, key: string): Json[] {
  const items = isObject(data) ? data[key] : undefined;
  if (!Array.isArray(items)) throw new AdapterError("unavailable", `Unexpected cTrader CLI answer: no "${key}" list`);
  return items.filter(isObject);
}

function unexpected(what: string, item: Json): AdapterError {
  return new AdapterError(
    "unavailable",
    `Unexpected cTrader CLI ${what} format, fields: ${Object.keys(item).join(", ")}`,
  );
}

/** Batch `accounts` (all linked accounts) merged with the shell's `accounts` (active ones, with names). */
export function toBrokerAccounts(batch: unknown, active: unknown): BrokerAccount[] {
  if (!Array.isArray(batch)) throw new AdapterError("unavailable", "Unexpected cTrader CLI accounts format");
  const details = active === undefined ? undefined : list(active, "accounts");
  return batch.filter(isObject).map((a) => {
    const number = str(a["Number"]);
    const broker = str(a["Broker"]);
    const currency = str(a["DepositCurrency"]);
    if (!number || !broker || !currency) throw unexpected("account", a);
    const detail = details?.find((d) => str(d["traderLogin"]) === number);
    const name = str(detail?.["accountName"]);
    return {
      number,
      broker,
      currency,
      live: a["Live"] === true,
      ...(details ? { active: detail !== undefined && str(detail["accountStatus"]) === "Active" } : {}),
      ...optional("name", name),
    };
  });
}

export function toSymbols(data: unknown): string[] {
  if (!Array.isArray(data)) throw new AdapterError("unavailable", "Unexpected cTrader CLI symbols format");
  return data.filter(isObject).flatMap((s) => (str(s["Name"]) ? [str(s["Name"]) as string] : []));
}

export function toAccountStats(data: unknown, time: Date): AccountStats {
  if (!isObject(data)) throw new AdapterError("unavailable", "Unexpected cTrader CLI account format");
  const balance = num(data["balance"]);
  const equity = num(data["equity"]);
  if (balance === undefined || equity === undefined) throw unexpected("account", data);
  return {
    balance,
    equity,
    ...optional("margin", num(data["margin"])),
    ...optional("freeMargin", num(data["freeMargin"])),
    time: time.toISOString(),
  };
}

/** Closing deals: `orderId, positionId, symbolName, side, filledVolumeLots, executionPrice, grossProfit, commission, swap, label, time`. */
export function toDeals(data: unknown): Deal[] {
  return list(data, "deals").map((d) => {
    const id = str(d["orderId"]);
    const positionId = str(d["positionId"]);
    const symbol = str(d["symbolName"]);
    const direction = side(d["side"]);
    const volume = num(d["filledVolumeLots"]) ?? num(d["filledVolume"]);
    const price = num(d["executionPrice"]);
    const pnl = num(d["grossProfit"]);
    const time = str(d["time"]);
    if (
      !id ||
      !positionId ||
      !symbol ||
      !direction ||
      volume === undefined ||
      price === undefined ||
      pnl === undefined ||
      !time
    ) {
      throw unexpected("deal", d);
    }
    const label = str(d["label"]);
    return {
      id,
      positionId,
      symbol,
      side: direction,
      volume,
      price,
      pnl,
      ...optional("commission", num(d["commission"])),
      ...optional("swap", num(d["swap"])),
      ...(label ? { label } : {}),
      time: new Date(time).toISOString(),
    };
  });
}

/**
 * Open positions. Field names are assumed to follow the completed-order format
 * (`symbolName, tradeSide, volumeLots, stopLoss, takeProfit, openTime, label`) – verify on a trading day.
 */
/**
 * A fresh shell session lists open positions before it has prices for them: `currentPrice`,
 * `netProfit` and `grossProfit` are null for a moment (seen with 5.9).
 */
export function positionsWithoutPrices(data: unknown): boolean {
  return list(data, "positions").some((p) => p["netProfit"] === null && p["grossProfit"] === null);
}

/**
 * `positions` (5.9): id, symbolName, tradeSide, volume, volumeLots, entryPrice, currentPrice, pips,
 * grossProfit, netProfit, swap, commission, stopLoss, takeProfit, openTime, label, comment.
 */
export function toPositions(data: unknown): Position[] {
  return list(data, "positions").map((p) => {
    const id = str(p["positionId"]) ?? str(p["id"]);
    const symbol = str(p["symbolName"]);
    const direction = side(p["tradeSide"]) ?? side(p["side"]);
    const volume = num(p["volumeLots"]) ?? num(p["volume"]);
    const entry = num(p["entryPrice"]) ?? num(p["openPrice"]) ?? num(p["executionPrice"]);
    const pnl = num(p["netProfit"]) ?? num(p["grossProfit"]) ?? num(p["profit"]);
    const openedAt = str(p["openTime"]) ?? str(p["time"]);
    if (!id || !symbol || !direction || volume === undefined || entry === undefined || pnl === undefined || !openedAt) {
      throw unexpected("position", p);
    }
    const label = str(p["label"]);
    return {
      id,
      symbol,
      side: direction,
      volume,
      entry,
      pnl,
      ...optional("sl", num(p["stopLoss"])),
      ...optional("tp", num(p["takeProfit"])),
      ...(label ? { label } : {}),
      openedAt: new Date(openedAt).toISOString(),
    };
  });
}

const ORDER_TYPES: Record<string, PendingOrder["type"]> = { limit: "limit", stop: "stop", stoplimit: "stopLimit" };

/** `orders` (5.9): id, symbolName, tradeSide, orderType, volume, volumeLots, targetPrice, limitPrice, stopLoss, takeProfit, expiration, label, comment. */
export function toPendingOrders(data: unknown): PendingOrder[] {
  return list(data, "orders").map((o) => {
    const id = str(o["id"]) ?? str(o["orderId"]);
    const symbol = str(o["symbolName"]);
    const direction = side(o["tradeSide"]) ?? side(o["side"]);
    const type = ORDER_TYPES[(str(o["orderType"]) ?? "").toLowerCase()];
    const volume = num(o["volumeLots"]) ?? num(o["volume"]);
    const price = num(o["targetPrice"]) ?? num(o["price"]) ?? num(o["limitPrice"]) ?? num(o["stopPrice"]);
    if (!id || !symbol || !direction || !type || volume === undefined || price === undefined)
      throw unexpected("order", o);
    const label = str(o["label"]);
    return {
      id,
      symbol,
      type,
      side: direction,
      volume,
      price,
      ...optional("sl", num(o["stopLoss"])),
      ...optional("tp", num(o["takeProfit"])),
      ...(label ? { label } : {}),
      ...optional("expiresAt", isoTime(o["expiration"])),
    };
  });
}

const PARAMETER_TYPES: Record<string, ParameterSchema["type"]> = {
  Integer: "int",
  Double: "double",
  Boolean: "bool",
  String: "string",
  Enum: "enum",
  Color: "color",
  Symbol: "symbol",
  TimeFrame: "period",
};

/** `{ "A": 255, "R": 255, "G": 0, "B": 0 }` → `#FFFF0000`. */
export function toColor(value: unknown): string | undefined {
  if (!isObject(value)) return typeof value === "string" ? value : undefined;
  const parts = [value["A"], value["R"], value["G"], value["B"]];
  if (!parts.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255)) return undefined;
  return `#${(parts as number[]).map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/** Batch `metadata`: `Name, BuildTime, Parameters[{PropertyName, FriendlyName, GroupName, Type, DefaultValue, MinValue, MaxValue, EnumValues}]`. */
export function toAlgoMetadata(data: unknown): AlgoMetadata {
  if (!isObject(data) || !str(data["Name"]) || !Array.isArray(data["Parameters"])) {
    throw new AdapterError("unavailable", "Unexpected cTrader CLI metadata format");
  }
  const parameters = (data["Parameters"] as unknown[]).filter(isObject).map((p): ParameterSchema => {
    const name = str(p["PropertyName"]);
    if (!name) throw unexpected("parameter", p);
    const type = PARAMETER_TYPES[str(p["Type"]) ?? ""] ?? "string";
    const enumValues = isObject(p["EnumValues"]) ? (p["EnumValues"] as Record<string, unknown>) : undefined;
    // Enum defaults are numbers in the CLI output; the core works with the option names.
    // Colour defaults are { A, R, G, B }; `run` takes them as #AARRGGBB.
    const defaultValue =
      type === "enum" && enumValues
        ? Object.keys(enumValues).find((k) => enumValues[k] === p["DefaultValue"])
        : type === "color"
          ? toColor(p["DefaultValue"])
          : p["DefaultValue"];
    return {
      name,
      type,
      ...optional("label", str(p["FriendlyName"])),
      ...optional("group", str(p["GroupName"])),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...optional("min", num(p["MinValue"])),
      ...optional("max", num(p["MaxValue"])),
      ...optional("step", num(p["Step"])),
      ...(enumValues ? { options: Object.keys(enumValues) } : {}),
      ...(enumValues && Object.values(enumValues).every((v) => typeof v === "number")
        ? { optionValues: Object.values(enumValues) as number[] }
        : {}),
    };
  });
  const buildTime = str(data["BuildTime"]);
  const accessRights = str(data["AccessRights"]);
  return {
    name: str(data["Name"]) as string,
    // "None" runs in the sandbox; anything else (e.g. "FullTrust") needs --full-access.
    ...(accessRights ? { fullAccess: accessRights !== "None" } : {}),
    ...(buildTime && !Number.isNaN(Date.parse(buildTime)) ? { buildTime: new Date(buildTime).toISOString() } : {}),
    parameters,
  };
}

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parameter names are the metadata's PropertyName: plain identifiers, nothing else. */
export function checkParameterNames(parameters: ParameterValues): void {
  for (const name of Object.keys(parameters)) {
    if (!PARAMETER_NAME.test(name)) throw new AdapterError("invalid_input", `Invalid parameter name ${name}`);
  }
}

// `run` prints every parameter at start: "| Name                 | Value                     | Source |".
const TABLE_ROW = /^(\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|)([^|]*)(\|\s*(?:cbotset|cmd arg|default value)\s*\|\s*)$/;
const SECRET_NAME = /key|token|secret|passw|licen[cs]e|credential|api/i;
const HIDDEN = " ••••••";

/** The value of parameters that look like secrets (licence keys, tokens) in the start table. */
export function redactStartupTable(text: string): string {
  const row = TABLE_ROW.exec(text);
  const cell = row?.[3];
  if (!row?.[2] || !SECRET_NAME.test(row[2]) || !cell?.trim()) return text;
  // The whole cell, so the columns keep their width.
  return `${row[1] ?? ""}${HIDDEN.padEnd(cell.length)}${row[4] ?? ""}`;
}

// Platform lines of `run` start with the time or with the message, never with a level like the
// cBot's own Print output ("<time> | Info | …"), so a bot cannot fake them by accident.
const PLATFORM_LINE = String.raw`^(?:\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}\.\d+ \| )?`;
const CONNECTION_LOST = new RegExp(`${PLATFORM_LINE}The connection has been lost\\b`);
const CONNECTION_UP = new RegExp(`${PLATFORM_LINE}The connection has been (?:established|restored)\\b`);
// Logged by the platform with level Error; Print output of a cBot is always Info.
const ALGO_CRASHED = new RegExp(`${PLATFORM_LINE}Error \\| Crashed in \\S+ event with `);

/**
 * "The connection has been lost. Reconnecting..." / "… restored." and "Error | Crashed in
 * Timer.TimerTick event with InvalidOperationException: …" (the cBot keeps running) as logged by `run` (5.9).
 */
export function toLogEvent(text: string): LogEvent | undefined {
  if (CONNECTION_LOST.test(text)) return "connection_lost";
  if (CONNECTION_UP.test(text)) return "connection_restored";
  if (ALGO_CRASHED.test(text)) return "algo_crashed";
  return undefined;
}
