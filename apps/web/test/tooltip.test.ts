import { afterEach, describe, expect, it, vi } from "vitest";
import { placeTooltips } from "../src/tooltip";

placeTooltips();

function tip(right: number, top = 400) {
  const el = document.createElement("button");
  el.dataset["tooltip"] = "A long description";
  el.getBoundingClientRect = () => ({ right, top }) as DOMRect;
  document.body.append(el);
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("placeTooltips", () => {
  it("hangs a tooltip from the left edge when it would leave the window on the left", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ width: "300px", height: "28px" } as CSSStyleDeclaration);
    const nearLeft = tip(120);
    nearLeft.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(nearLeft.dataset["tooltipAlign"]).toBe("start");

    const nearRight = tip(900);
    nearRight.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(nearRight.dataset["tooltipAlign"]).toBeUndefined();
  });

  it("shows a tooltip below its element when there is no room above", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ width: "80px", height: "28px" } as CSSStyleDeclaration);
    const nearTop = tip(900, 20);
    nearTop.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(nearTop.dataset["tooltipSide"]).toBe("below");
    const lower = tip(900, 200);
    lower.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(lower.dataset["tooltipSide"]).toBeUndefined();
  });
});
