import { enableAutoUnmount } from "@vue/test-utils";
import { afterAll } from "vitest";

// Components a test file left mounted keep their timers (usePolling ticks every second); one firing after the test
// environment is torn down fails the whole run with "document is not defined".
enableAutoUnmount(afterAll);
