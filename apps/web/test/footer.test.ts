import type { SystemInfo } from "@wickwatch/core";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AppFooter from "../src/components/AppFooter.vue";
import { i18n, setLocale } from "../src/i18n";
import { system } from "../src/system";

const info = (extra: Partial<SystemInfo> = {}): SystemInfo => ({
  version: "0.1.0",
  defaultLocale: "en",
  labelPrefix: "wickwatch",
  adapters: { runtime: "demo", broker: "demo", config: "demo" },
  capabilities: {
    backtest: false,
    optimize: false,
    partialClose: false,
    pendingOrders: true,
    emergencyStop: true,
    parameterExport: [],
  },
  algoFormats: ["algo"],
  parameterFormats: [],
  sourceUrl: "https://github.com/wickwatch/wickwatch",
  mcp: true,
  apiTokensRequire2fa: false,
  newsCalendar: false,
  ...extra,
});

afterEach(() => {
  system.value = undefined;
});

describe("AppFooter", () => {
  it("shows the version, the source code and the support link", () => {
    setLocale("en");
    system.value = info({ supportUrl: "https://ko-fi.com/mmohrx" });
    const links = mount(AppFooter, { global: { plugins: [i18n] } }).findAll("a");
    expect(links.map((a) => [a.text(), a.attributes("href"), a.attributes("rel")])).toEqual([
      ["Source code (AGPL-3.0)", "https://github.com/wickwatch/wickwatch", "noopener noreferrer"],
      ["Support the project", "https://ko-fi.com/mmohrx", "noopener noreferrer"],
    ]);
  });

  it("leaves out the support link when it is off, and everything before the server answered", () => {
    setLocale("de");
    system.value = info();
    const wrapper = mount(AppFooter, { global: { plugins: [i18n] } });
    expect(wrapper.text()).toContain("wickwatch 0.1.0");
    expect(wrapper.findAll("a").map((a) => a.text())).toEqual(["Quellcode (AGPL-3.0)"]);
    system.value = undefined;
    expect(
      mount(AppFooter, { global: { plugins: [i18n] } })
        .find("footer")
        .exists(),
    ).toBe(false);
  });
});
