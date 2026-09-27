import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s), the defaults every authenticator app supports.
const DIGITS = 6;
const PERIOD_S = 30;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random secret, base32 as authenticator apps expect it. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const totpCounter = (time: number) => Math.floor(time / 1000 / PERIOD_S);

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched counter, or undefined. Codes at or before `lastCounter` are rejected (no replay).
 */
export function verifyTotp(secret: string, code: string, time: number, lastCounter = -1): number | undefined {
  const normalised = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalised)) return undefined;
  const now = totpCounter(time);
  for (const counter of [now - 1, now, now + 1]) {
    if (counter <= lastCounter) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, counter)), Buffer.from(normalised))) return counter;
  }
  return undefined;
}

export function totpUri(secret: string, account: string, issuer = "Wickwatch"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
