import { describe, expect, it } from "vitest";
import { splitLabel } from "../src/parameter-label";

describe("splitLabel", () => {
  it("moves a description after ' - ' out of the name", () => {
    expect(
      splitLabel(
        "Ausschlusszeiten Long - Eine oder mehrere Zeiten [hh:mm-hh:mm]. Zeit der Signal-Kerze. Kommasepariert ohne Leerzeichen.",
      ),
    ).toEqual({
      title: "Ausschlusszeiten Long",
      description: "Eine oder mehrere Zeiten [hh:mm-hh:mm]. Zeit der Signal-Kerze. Kommasepariert ohne Leerzeichen.",
    });
    expect(splitLabel("Risk per trade – percent of the balance at the time of entry").title).toBe("Risk per trade");
  });

  it("keeps hyphens inside words and short rests in the name", () => {
    expect(splitLabel("Trailing-SL Short aktiv")).toEqual({ title: "Trailing-SL Short aktiv" });
    expect(splitLabel("Risk - Reward")).toEqual({ title: "Risk - Reward" });
    expect(splitLabel(" - only a description that is long enough here")).toEqual({
      title: " - only a description that is long enough here",
    });
  });
});
