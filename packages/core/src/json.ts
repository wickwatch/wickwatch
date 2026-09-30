/** A parsed JSON object (not an array, not null), e.g. from a broker's output or an uploaded file. */
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
