import { describe, expect, it } from "vitest";
import { algoFamilyKey, nameVersion } from "../src/rules";

describe("algo families", () => {
  it("reads a version at the end of a name", () => {
    expect(nameVersion("Sample-Bot-v4.11")).toBe("v4.11");
    expect(nameVersion("Sample Bot v4.2")).toBe("v4.2");
    expect(nameVersion("Bot_2.0")).toBe("v2.0");
    expect(nameVersion("alpha")).toBeUndefined();
    // Digits belonging to the name are no version.
    expect(nameVersion("US30Bot2")).toBeUndefined();
    expect(nameVersion("NAS_100")).toBeUndefined();
    expect(nameVersion("Bot-v4")).toBe("v4");
  });

  it("matches names of the same algo whatever version, extension, case or separators", () => {
    const key = algoFamilyKey("Sample-Bot-v4.11");
    expect(algoFamilyKey("Sample Bot v4.2.algo", ["algo"])).toBe(key);
    expect(algoFamilyKey("sample_bot", ["algo"])).toBe(key);
    expect(algoFamilyKey("Other Bot v4.2.algo", ["algo"])).not.toBe(key);
    // Different bots that only differ by a number stay apart.
    expect(algoFamilyKey("NAS_30.algo", ["algo"])).not.toBe(algoFamilyKey("NAS_100"));
  });
});
