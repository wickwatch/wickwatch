/** Room kept between a tooltip and the edge of the window. */
const MARGIN = 8;

/**
 * Tooltips (`data-tooltip`, base.css) hang from the right edge of their element, which suits row actions at the end
 * of a line. Just before one shows, this checks whether it would leave the window on the left (an info button next to
 * a name, say) and then hangs it from the left edge instead; without room above, it goes below.
 */
export function placeTooltips(root: Document = document): void {
  const place = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
    if (!(target instanceof HTMLElement)) return;
    delete target.dataset["tooltipAlign"];
    delete target.dataset["tooltipSide"];
    // The tooltip is laid out while hidden, so its size is known before it appears.
    const tip = getComputedStyle(target, "::after");
    const box = target.getBoundingClientRect();
    if (box.right - (Number.parseFloat(tip.width) || 0) < MARGIN) target.dataset["tooltipAlign"] = "start";
    // No room above (top of the window, or of the dialog it sits in, which clips it): below instead.
    const ceiling = target.closest("dialog")?.getBoundingClientRect().top ?? 0;
    if (box.top - (Number.parseFloat(tip.height) || 0) - ceiling < MARGIN) target.dataset["tooltipSide"] = "below";
  };
  root.addEventListener("pointerover", place);
  root.addEventListener("focusin", place);
}
