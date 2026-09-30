import { afterEach, describe, expect, it, vi } from "vitest";
import { placeTooltips } from "../src/tooltip";

placeTooltips();

function tip(right: number) {
  const el = document.createElement("button");
  el.dataset["tooltip"] = "A long description";
  el.getBoundingClientRect = () => ({ right }) as DOMRect;
  document.body.append(el);
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("placeTooltips", () => {
  it("hangs a tooltip from the left edge when it would leave the window on the left", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ width: "300px" } as CSSStyleDeclaration);
    const nearLeft = tip(120);
    nearLeft.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(nearLeft.dataset["tooltipAlign"]).toBe("start");

    const nearRight = tip(900);
    nearRight.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(nearRight.dataset["tooltipAlign"]).toBeUndefined();
  });
});
