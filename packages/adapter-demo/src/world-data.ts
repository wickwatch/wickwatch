import type { InstanceStatus, OrderType, ParameterSchema, Side } from "@wickwatch/core";

// Static demo data. Names are neutral on purpose: no real firms, brokers or accounts.

export interface DemoSymbol {
  price: number;
  digits: number;
  contractSize: number;
}

export const SYMBOLS: Record<string, DemoSymbol> = {
  GER40: { price: 19_400, digits: 1, contractSize: 1 },
  NAS100: { price: 18_500, digits: 1, contractSize: 1 },
  US30: { price: 39_800, digits: 1, contractSize: 1 },
  US500: { price: 5_300, digits: 2, contractSize: 1 },
  EURUSD: { price: 1.085, digits: 5, contractSize: 100_000 },
  XAUUSD: { price: 2_350, digits: 2, contractSize: 100 },
};

export interface DemoAccount {
  number: string;
  broker: string;
  currency: string;
  live: boolean;
  startBalance: number;
  prop?: string;
  /** What a user would enter in the UI for a real account. */
  displayName: string;
  credentialLabel: string;
}

export const ACCOUNTS: DemoAccount[] = [
  {
    number: "1111111",
    broker: "Demo Broker",
    currency: "USD",
    live: false,
    startBalance: 100_000,
    prop: "demo-prop-a",
    displayName: "Demo Prop A Challenge",
    credentialLabel: "Demo login A",
  },
  {
    number: "2222222",
    broker: "Demo Broker",
    currency: "USD",
    live: false,
    startBalance: 50_000,
    prop: "demo-prop-b",
    displayName: "Demo Prop B Challenge",
    credentialLabel: "Demo login B",
  },
  {
    number: "3333333",
    broker: "Demo Broker",
    currency: "EUR",
    live: false,
    startBalance: 10_000,
    displayName: "Own account",
    credentialLabel: "Demo login A",
  },
];

export interface DemoAlgo {
  version: string;
  parameters: ParameterSchema[];
}

export const ALGOS: Record<string, DemoAlgo> = {
  alpha: {
    version: "1.5.0",
    parameters: [
      { name: "BotVersion", type: "string", default: "1.5.0" },
      {
        name: "RiskPercent",
        type: "double",
        label: "Risk %",
        group: "Risk",
        default: 0.5,
        min: 0.1,
        max: 2,
        step: 0.1,
      },
      { name: "StopLossPoints", type: "int", group: "Risk", default: 40, min: 5, max: 500, step: 5 },
      { name: "TakeProfitPoints", type: "int", group: "Risk", default: 80, min: 5, max: 1000, step: 5 },
      { name: "SessionStart", type: "time", group: "Session", default: "08:00" },
      { name: "SessionEnd", type: "time", group: "Session", default: "17:30" },
      { name: "EntryMode", type: "enum", group: "Signal", default: "Breakout", options: ["Breakout", "Pullback"] },
      { name: "UseTrendFilter", type: "bool", group: "Signal", default: true },
      { name: "TrendPeriod", type: "period", group: "Signal", default: "H1" },
    ],
  },
  beta: {
    version: "2.1.0",
    parameters: [
      { name: "BotVersion", type: "string", default: "2.1.0" },
      { name: "Lots", type: "double", default: 0.5, min: 0.01, max: 10, step: 0.01 },
      { name: "FastPeriod", type: "int", default: 12, min: 2, max: 100 },
      { name: "SlowPeriod", type: "int", default: 26, min: 5, max: 300 },
      { name: "DailyEquityStopPercent", type: "double", default: 3, min: 0.5, max: 10, step: 0.5 },
      { name: "HedgeSymbol", type: "symbol", default: "US500" },
    ],
  },
};

export function algoPath(name: string, version: string): string {
  return `algos/${name}/${version}/${name}.algo`;
}

export interface DemoInstanceSeed {
  name: string;
  account: string;
  algo: string;
  symbol: string;
  period: string;
  status: InstanceStatus;
  uptimeHours: number;
  restartCount: number;
  volume: number;
  positions: Array<{ side: Side; hoursAgo: number; slDistance: number; tpDistance: number }>;
  orders: Array<{ type: OrderType; side: Side; distance: number }>;
}

export const INSTANCES: DemoInstanceSeed[] = [
  {
    name: "alpha-ger40-a",
    account: "1111111",
    algo: "alpha",
    symbol: "GER40",
    period: "M5",
    status: "running",
    uptimeHours: 76,
    restartCount: 0,
    volume: 1,
    positions: [{ side: "buy", hoursAgo: 2, slDistance: 40, tpDistance: 80 }],
    orders: [],
  },
  {
    name: "beta-nas100-a",
    account: "1111111",
    algo: "beta",
    symbol: "NAS100",
    period: "M5",
    status: "running",
    uptimeHours: 76,
    restartCount: 0,
    volume: 0.5,
    positions: [],
    orders: [{ type: "limit", side: "sell", distance: 60 }],
  },
  {
    name: "alpha-us30-b",
    account: "2222222",
    algo: "alpha",
    symbol: "US30",
    period: "M5",
    status: "running",
    uptimeHours: 26,
    restartCount: 1,
    volume: 0.5,
    positions: [{ side: "sell", hoursAgo: 5, slDistance: 80, tpDistance: 160 }],
    orders: [],
  },
  {
    name: "beta-us500-own",
    account: "3333333",
    algo: "beta",
    symbol: "US500",
    period: "M15",
    status: "error",
    uptimeHours: 0,
    restartCount: 3,
    volume: 0.5,
    positions: [],
    orders: [],
  },
];
