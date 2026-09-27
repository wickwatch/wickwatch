import { describe, expect, it } from "vitest";
import de from "../../../i18n/de.json";
import en from "../../../i18n/en.json";

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ""): Map<string, string> {
  return new Map(
    Object.entries(messages).flatMap(([key, value]) =>
      typeof value === "string" ? [[`${prefix}${key}`, value]] : [...flatten(value, `${prefix}${key}.`)],
    ),
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const english = flatten(en);
  const german = flatten(de);

  it("have the same keys in English and German", () => {
    expect([...german.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("use the same placeholders and plural forms", () => {
    for (const [key, text] of english) {
      const translated = german.get(key) ?? "";
      expect(placeholders(translated), key).toEqual(placeholders(text));
      expect(translated.split("|").length, key).toBe(text.split("|").length);
    }
  });
});
