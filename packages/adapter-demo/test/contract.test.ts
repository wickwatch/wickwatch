import { describeBrokerAdapter, describeConfigAdapter, describeRuntimeAdapter } from "@wickwatch/core/testing";
import { createDemoAdapters, DEMO_INVALID_SECRET, demoAlgoPath } from "../src";

const setup = () => createDemoAdapters({ logIntervalMs: 10 });
const credentials = { login: "demo", secret: "demo" };

describeRuntimeAdapter("demo", {
  setup: () => setup().runtime,
  spec: {
    name: "contract-test",
    image: "wickwatch-demo-runtime:1.0.0",
    command: ["run", demoAlgoPath("alpha", "1.5.0"), "--account=1111111", "--symbol=GER40", "--period=H1"],
    files: [],
    labels: { "wickwatch.instance": "contract-test" },
  },
});

describeBrokerAdapter("demo", {
  setup: () => setup().broker,
  credentials,
  invalidCredentials: { login: "demo", secret: DEMO_INVALID_SECRET },
  algoPath: demoAlgoPath("alpha", "1.5.0"),
  destructive: true,
});

describeConfigAdapter("demo", {
  setup: () => setup().config,
  path: "sets/contract-test.json",
  values: { Risk: 0.5, Lookback: 20, UseFilter: true, Mode: "Fast", Start: "08:00", Chart: "H1" },
  schema: [
    { name: "Risk", type: "double", min: 0.1, max: 2 },
    { name: "Lookback", type: "int" },
    { name: "UseFilter", type: "bool" },
    { name: "Mode", type: "enum", options: ["Fast", "Slow"] },
    { name: "Start", type: "time" },
    { name: "Chart", type: "period" },
  ],
});
