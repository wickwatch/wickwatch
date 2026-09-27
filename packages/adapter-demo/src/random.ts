/** FNV-1a hash of the joined parts. */
export function hash(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic value in [0, 1) for the given parts (mulberry32 step over the hash). */
export function random(...parts: Array<string | number>): number {
  let t = (hash(...parts) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Stable numeric id, 8 digits. */
export function numericId(...parts: Array<string | number>): string {
  return String(10_000_000 + (hash(...parts) % 90_000_000));
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
