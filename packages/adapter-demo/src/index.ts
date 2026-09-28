// Demo adapter: runtime, broker and config with deterministic fake data,
// for development, tests and screenshots. Needs no broker and no Docker.
import { DemoBrokerAdapter } from "./broker";
import { DemoConfigAdapter } from "./config";
import { DemoRuntimeAdapter } from "./runtime";
import { DemoWorld, type DemoOptions } from "./world";

export { DEMO_INVALID_SECRET, DemoBrokerAdapter } from "./broker";
export { DemoConfigAdapter } from "./config";
export { DemoRuntimeAdapter } from "./runtime";
export { DemoWorld, type DemoOptions } from "./world";
export { ACCOUNTS as DEMO_ACCOUNTS, algoPath as demoAlgoPath } from "./world-data";

export interface DemoAdapters {
  runtime: DemoRuntimeAdapter;
  broker: DemoBrokerAdapter;
  config: DemoConfigAdapter;
  world: DemoWorld;
}

/** Creates the three demo adapters on one shared world, so stopping or closing is consistent. */
export function createDemoAdapters(options: DemoOptions = {}): DemoAdapters {
  const world = new DemoWorld(options);
  return {
    runtime: new DemoRuntimeAdapter(world),
    broker: new DemoBrokerAdapter(world),
    config: new DemoConfigAdapter(),
    world,
  };
}
