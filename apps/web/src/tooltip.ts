/** Room kept between a tooltip and the edge of the window. */
const MARGIN = 8;
/** Gap between a tooltip and its element, as in base.css. */
const GAP = 6;
const CLIPPING = new Set(["auto", "scroll", "hidden", "clip"]);

/**
 * Tooltips (`data-tooltip`, base.css) hang from the right edge of their element, which suits row actions at the end
 * of a line. Just before one shows, this checks whether it would leave the window on the left (an info button next to
 * a name, say) and then hangs it from the left edge instead; without room above, it goes below. Inside an element that
 * cuts off what sticks out (a table that scrolls sideways), it is placed on the window instead, so nothing cuts it off.
 *
 * Touch has no hover: a click or tap on an element with `data-tooltip-pin` pins its tooltip open, one at a time. A
 * click elsewhere, Escape or scrolling (a tooltip on the window would stay behind) closes it again.
 */
export function placeTooltips(root: Document = document): void {
  const place = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
    if (target instanceof HTMLElement) placeTooltip(target);
  };
  root.addEventListener("pointerover", place);
  root.addEventListener("focusin", place);

  let pinned: HTMLElement | undefined;
  const unpin = () => {
    if (pinned) delete pinned.dataset["tooltipPinned"];
    pinned = undefined;
  };
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tooltip-pin]") : null;
    if (!(target instanceof HTMLElement)) return;
    const again = target === pinned;
    unpin();
    if (again) return;
    placeTooltip(target);
    target.dataset["tooltipPinned"] = "";
    pinned = target;
  });
  root.addEventListener("pointerdown", (event) => {
    if (pinned && !(event.target instanceof Node && pinned.contains(event.target))) unpin();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") unpin();
  });
  root.addEventListener("scroll", unpin, { capture: true, passive: true });
}

/** Places one element's tooltip, e.g. before it is pinned open by a click (touch has no hover). */
export function placeTooltip(target: HTMLElement): void {
  delete target.dataset["tooltipAlign"];
  delete target.dataset["tooltipSide"];
  delete target.dataset["tooltipFixed"];
  // The tooltip is laid out while hidden, so its size is known before it appears.
  const tip = getComputedStyle(target, "::after");
  const width = Number.parseFloat(tip.width) || 0;
  const height = Number.parseFloat(tip.height) || 0;
  const box = target.getBoundingClientRect();
  const alignStart = box.right - width < MARGIN;
  if (alignStart) target.dataset["tooltipAlign"] = "start";
  // A dialog clips too, but may move (a drawer slides in), which would carry a fixed tooltip with it: there the
  // tooltip only goes below when there is no room above.
  const dialog = target.closest("dialog");
  const ceiling = dialog?.getBoundingClientRect().top ?? 0;
  const below = box.top - height - ceiling < MARGIN;
  if (below) target.dataset["tooltipSide"] = "below";
  if (dialog || !clipped(target)) return;
  const left = Math.max(MARGIN, Math.min(alignStart ? box.left : box.right - width, innerWidth - width - MARGIN));
  target.dataset["tooltipFixed"] = "";
  target.style.setProperty("--tooltip-left", `${String(left)}px`);
  target.style.setProperty("--tooltip-top", `${String(below ? box.bottom + GAP : box.top - GAP - height)}px`);
}

/** Inside an element that cuts off what sticks out of it. */
function clipped(target: HTMLElement): boolean {
  for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (CLIPPING.has(style.overflowX) || CLIPPING.has(style.overflowY)) return true;
  }
  return false;
}
