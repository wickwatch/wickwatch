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
  /** "More actions" menu. */
  more: [
    { tag: "circle", cx: 5.5, cy: 12, r: 1 },
    { tag: "circle", cx: 12, cy: 12, r: 1 },
    { tag: "circle", cx: 18.5, cy: 12, r: 1 },
  ],
  edit: [path("M4.5 19.5l1-4L16 5a2.1 2.1 0 0 1 3 3L8.5 18.5z"), path("M14 7l3 3")],
  duplicate: [
    { tag: "rect", x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 },
    path("M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"),
  ],
  download: [path("M12 4.5v11"), path("M7.5 11l4.5 4.5 4.5-4.5"), path("M5 19.5h14")],
  upload: [path("M12 15.5v-11"), path("M7.5 9l4.5-4.5L16.5 9"), path("M5 19.5h14")],
  key: [
    { tag: "circle", cx: 8, cy: 15.5, r: 4 },
    path("M11 12.5l8.5-8.5"),
    path("M16.5 7l2.5 2.5"),
    path("M14 9.5l2 2"),
  ],
  plus: [path("M12 5v14M5 12h14")],
  info: [{ tag: "circle", cx: 12, cy: 12, r: 8.5 }, path("M12 11v5.5"), path("M12 7.75v.5")],
  search: [{ tag: "circle", cx: 10.5, cy: 10.5, r: 6 }, path("M15 15l4.5 4.5")],
  trash: [
    path("M4.5 7h15"),
    path("M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"),
    path("M6.5 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"),
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
