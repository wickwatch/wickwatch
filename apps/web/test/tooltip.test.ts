import { afterEach, describe, expect, it, vi } from "vitest";
import { placeTooltips } from "../src/tooltip";

placeTooltips();

function tip(right: number, top = 400, parent: HTMLElement = document.body) {
  const el = document.createElement("button");
  el.dataset["tooltip"] = "A long description";
  el.getBoundingClientRect = () => ({ left: right - 30, right, top, bottom: top + 30 }) as DOMRect;
  parent.append(el);
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

describe("placeTooltips inside an element that clips", () => {
  const styles = (overflow: string) =>
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el, pseudo) =>
        (pseudo
          ? { width: "200px", height: "80px" }
          : {
              overflowX: (el as HTMLElement).classList.contains("wrap") ? overflow : "visible",
              overflowY: "visible",
            }) as unknown as CSSStyleDeclaration,
    );

  it("places the tooltip on the window, so a table that scrolls sideways does not cut it off", () => {
    styles("auto");
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    document.body.append(wrap);
    const button = tip(900, 400, wrap);
    button.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(button.dataset["tooltipFixed"]).toBe("");
    // Above the button, flush with its right edge.
    expect(button.style.getPropertyValue("--tooltip-top")).toBe("314px");
    expect(button.style.getPropertyValue("--tooltip-left")).toBe("700px");

    // No room above: below it.
    const high = tip(900, 50, wrap);
    high.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(high.style.getPropertyValue("--tooltip-top")).toBe("86px");
  });

  it("leaves tooltips outside such an element and in dialogs as they are", () => {
    styles("visible");
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    document.body.append(wrap);
    const free = tip(900, 400, wrap);
    free.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(free.dataset["tooltipFixed"]).toBeUndefined();

    vi.restoreAllMocks();
    styles("auto");
    const dialog = document.createElement("dialog");
    dialog.className = "wrap";
    document.body.append(dialog);
    const inDialog = tip(900, 400, dialog);
    inDialog.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(inDialog.dataset["tooltipFixed"]).toBeUndefined();
  });
});
