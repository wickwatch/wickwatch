/** Room kept between a tooltip and the edge of the window. */
const MARGIN = 8;

/**
 * Tooltips (`data-tooltip`, base.css) hang from the right edge of their element, which suits row actions at the end
 * of a line. Just before one shows, this checks whether it would leave the window on the left (an info button next to
 * a name, say) and then hangs it from the left edge instead.
 */
export function placeTooltips(root: Document = document): void {
  const place = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
    if (!(target instanceof HTMLElement)) return;
    delete target.dataset["tooltipAlign"];
    // The tooltip is laid out while hidden, so its width is known before it appears.
    const width = Number.parseFloat(getComputedStyle(target, "::after").width) || 0;
    if (target.getBoundingClientRect().right - width < MARGIN) target.dataset["tooltipAlign"] = "start";
  };
  root.addEventListener("pointerover", place);
  root.addEventListener("focusin", place);
}
