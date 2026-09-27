import { describe, expect, it } from "vitest";
import { createCipher } from "../src/security/cipher";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../src/security/password";
import { base32Decode, base32Encode, totpCode, totpCounter, totpUri, verifyTotp } from "../src/security/totp";

describe("cipher", () => {
  const cipher = createCipher(Buffer.alloc(32, 1));

  it("round-trips and uses a fresh IV every time", () => {
    const a = cipher.encrypt("s3cret", "credential-secret");
    expect(a).not.toBe(cipher.encrypt("s3cret", "credential-secret"));
    expect(cipher.decrypt(a, "credential-secret")).toBe("s3cret");
  });

  it("rejects tampering, the wrong purpose and the wrong key", () => {
    const payload = cipher.encrypt("s3cret", "credential-secret");
    const [v, iv, tag, data] = payload.split(".");
    const flipped = Buffer.from(data!, "base64url");
    flipped[0]! ^= 1;
    expect(() => cipher.decrypt([v, iv, tag, flipped.toString("base64url")].join("."), "credential-secret")).toThrow();
    expect(() => cipher.decrypt(payload, "totp-secret")).toThrow();
    expect(() => createCipher(Buffer.alloc(32, 2)).decrypt(payload, "credential-secret")).toThrow();
  });
});

describe("password", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyDummyPassword("x")).toBe(false);
  });
});

describe("totp", () => {
  // RFC 6238, Appendix B: SHA-1 secret "12345678901234567890", 8-digit reference values.
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("matches RFC 6238 at t=%i", (seconds, expected) => {
    expect(totpCode(secret, totpCounter(seconds * 1000), 8)).toBe(expected);
  });

  it("round-trips base32", () => {
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(base32Decode("gezd gnbv-gy3t")).toEqual(base32Decode("GEZDGNBVGY3T"));
  });

  it("accepts one step of drift, rejects replays and junk", () => {
    const time = 1_800_000_000_000;
    const now = totpCounter(time);
    expect(verifyTotp(secret, totpCode(secret, now), time)).toBe(now);
    expect(verifyTotp(secret, totpCode(secret, now - 1), time)).toBe(now - 1);
    expect(verifyTotp(secret, totpCode(secret, now - 2), time)).toBeUndefined();
    expect(verifyTotp(secret, totpCode(secret, now), time, now)).toBeUndefined();
    expect(verifyTotp(secret, "12a456", time)).toBeUndefined();
  });

  it("builds an otpauth URI", () => {
    expect(totpUri("ABC", "admin")).toBe(
      "otpauth://totp/Wickwatch%3Aadmin?secret=ABC&issuer=Wickwatch&algorithm=SHA1&digits=6&period=30",
    );
  });
});
