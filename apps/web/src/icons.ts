/**
 * Line icons on a 24 × 24 grid, drawn with `currentColor` strokes, so they follow the text colour and both themes.
 * Add new icons here and render them with `<AppIcon>`; there is no icon font or library.
 */
type Shape =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx: number };

const path = (d: string): Shape => ({ tag: "path", d });

export const ICONS = {
  play: [path("M7.5 4.5v15l11.5-7.5z")],
  stop: [{ tag: "rect", x: 6, y: 6, width: 12, height: 12, rx: 1.5 }],
  restart: [path("M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"), path("M19.5 4.5V9H15")],
  sun: [
    { tag: "circle", cx: 12, cy: 12, r: 4 },
    path("M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"),
  ],
  moon: [path("M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z")],
  monitor: [{ tag: "rect", x: 3, y: 4, width: 18, height: 12, rx: 2 }, path("M8 20h8M12 16v4")],
  logout: [
    path("M10 4H5.5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5.5 20H10"),
    path("M15.5 8l4 4-4 4"),
    path("M19.5 12H9"),
  ],
  user: [{ tag: "circle", cx: 12, cy: 8, r: 4 }, path("M4.5 20a7.5 7.5 0 0 1 15 0")],
  chevronDown: [path("M6 9l6 6 6-6")],
  check: [path("M5 12.5l4.5 4.5L19 7.5")],
  close: [path("M6.5 6.5l11 11M17.5 6.5l-11 11")],
  /** "Not from this bot": take a trade out of the instance's figures. */
  exclude: [{ tag: "circle", cx: 12, cy: 12, r: 8.5 }, path("M6 6l12 12")],
  /** Undo an exclusion. */
  restore: [path("M9 14.5L4 9.5l5-5"), path("M4 9.5h10a5.5 5.5 0 0 1 0 11h-3")],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
