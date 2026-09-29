import { ref, watch } from "vue";

/** A point in SVG coordinates. */
export type Point = { x: number; y: number };

export const CURVES = ["smooth", "stepped"] as const;
export type Curve = (typeof CURVES)[number];

const STORAGE_KEY = "ww-chart-curve";

function stored(): Curve {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return CURVES.includes(value as Curve) ? (value as Curve) : "smooth";
  } catch {
    return "smooth";
  }
}

/** How line charts draw their line; remembered per browser. */
export const chartCurve = ref<Curve>(stored());

watch(chartCurve, (curve) => {
  try {
    localStorage.setItem(STORAGE_KEY, curve);
  } catch {
    // Not persisted in private mode.
  }
});

const round = (n: number) => Math.round(n * 100) / 100;

/** Horizontal, then vertical: the value only changes at the points. */
export function steppedPath(points: Point[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  return rest.reduce((d, p) => `${d} H${round(p.x)} V${round(p.y)}`, `M${round(first.x)},${round(first.y)}`);
}

/**
 * Monotone cubic curve through the points (Fritsch–Carlson): it passes every point and never goes
 * above or below its two neighbours, so it shows no value that did not exist. Points on the same x
 * keep the last one.
 */
export function smoothPath(input: Point[]): string {
  const points = input.filter((p, i) => input[i + 1]?.x !== p.x);
  const [first] = points;
  if (!first) return "";
  const n = points.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    slopes.push((b.y - a.y) / (b.x - a.x));
  }
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0] ?? 0;
    if (i === n - 1) return slopes[n - 2] ?? 0;
    const before = slopes[i - 1] as number;
    const after = slopes[i] as number;
    if (before * after <= 0) return 0;
    const h0 = (points[i] as Point).x - (points[i - 1] as Point).x;
    const h1 = (points[i + 1] as Point).x - (points[i] as Point).x;
    const weighted = (before * h1 + after * h0) / (h0 + h1);
    return Math.sign(before) * Math.min(2 * Math.abs(before), 2 * Math.abs(after), Math.abs(weighted));
  });
  let d = `M${round(first.x)},${round(first.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const third = (b.x - a.x) / 3;
    const c1 = `${round(a.x + third)},${round(a.y + (tangents[i] as number) * third)}`;
    const c2 = `${round(b.x - third)},${round(b.y - (tangents[i + 1] as number) * third)}`;
    d += ` C${c1} ${c2} ${round(b.x)},${round(b.y)}`;
  }
  return d;
}
