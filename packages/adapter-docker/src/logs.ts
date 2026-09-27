import { parseSetupLine, type LogLevel, type LogLine } from "@wickwatch/core";

/** Splits Docker's multiplexed log stream (8-byte frame headers) into payload chunks. */
export async function* demux(chunks: AsyncIterable<Buffer | string>): AsyncGenerator<Buffer> {
  let pending = Buffer.alloc(0);
  for await (const chunk of chunks) {
    pending = Buffer.concat([pending, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
    while (pending.length >= 8) {
      const size = pending.readUInt32BE(4);
      if (pending.length < 8 + size) break;
      yield pending.subarray(8, 8 + size);
      pending = pending.subarray(8 + size);
    }
  }
}

/** Joins chunks and yields complete lines; a final line without newline is yielded at the end. */
export async function* splitLines(chunks: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of chunks) {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) yield line.replace(/\r$/, "");
  }
  if (rest) yield rest;
}

// Bot output has no fixed level format; this keeps errors visible without claiming more than it knows.
function guessLevel(text: string): LogLevel {
  if (/\b(error|fatal|exception|failed|failure)\b/i.test(text)) return "error";
  if (/\bwarn(ing)?\b/i.test(text)) return "warn";
  return "info";
}

/** Parses "<RFC 3339 timestamp> <text>" as written with `timestamps: true`. */
export function toLogLine(raw: string, now: () => Date): LogLine {
  const space = raw.indexOf(" ");
  const stamp = space > 0 ? Date.parse(raw.slice(0, space)) : Number.NaN;
  const text = Number.isNaN(stamp) ? raw : raw.slice(space + 1);
  const setup = parseSetupLine(text);
  return {
    time: (Number.isNaN(stamp) ? now() : new Date(stamp)).toISOString(),
    text,
    level: guessLevel(text),
    ...(setup ? { setup } : {}),
  };
}
