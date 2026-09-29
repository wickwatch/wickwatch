import { describe, expect, it } from "vitest";
import { smoothPath, steppedPath, type Point } from "../src/chart-path";

/** The y values of a cubic segment at many t, for overshoot checks. */
function samples(d: string): number[] {
  const numbers = (s: string) => s.split(/[ ,]/).filter(Boolean).map(Number);
  const [move, ...segments] = d.split(" C");
  let [, y0] = numbers((move ?? "").slice(1));
  const ys: number[] = [];
  for (const segment of segments) {
    const [, y1, , y2, , y3] = numbers(segment);
    for (let t = 0; t <= 1; t += 0.05) {
      const u = 1 - t;
      ys.push(u ** 3 * y0! + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t ** 3 * y3!);
    }
    y0 = y3;
  }
  return ys;
}

const points: Point[] = [
  { x: 0, y: 100 },
  { x: 10, y: 80 },
  { x: 40, y: 80 },
  { x: 50, y: 20 },
  { x: 100, y: 60 },
];

describe("chart paths", () => {
  it("steps horizontally, then vertically", () => {
    expect(steppedPath(points.slice(0, 3))).toBe("M0,100 H10 V80 H40 V80");
    expect(steppedPath([])).toBe("");
  });

  it("draws the smooth curve through every point", () => {
    const d = smoothPath(points);
    expect(d.startsWith("M0,100")).toBe(true);
    for (const p of points.slice(1)) expect(d).toContain(` ${p.x},${p.y}`);
  });

  it("never goes beyond the values of the neighbouring points", () => {
    const ys = samples(smoothPath(points));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100 + 1e-9);
    // Flat between two equal values, no bump.
    const flat = samples(smoothPath(points.slice(1, 3)));
    expect(flat.every((y) => Math.abs(y - 80) < 1e-9)).toBe(true);
  });

  it("keeps the last of several points on the same x", () => {
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 5, y: 10 },
        { x: 5, y: 20 },
      ]),
    ).toMatch(/ 5,20$/);
  });
});
