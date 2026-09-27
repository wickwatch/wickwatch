import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** What a value is used for; bound into the ciphertext so values cannot be swapped between fields. */
export type Purpose = "credential-secret" | "totp-secret";

export interface Cipher {
  encrypt(plaintext: string, purpose: Purpose): string;
  decrypt(payload: string, purpose: Purpose): string;
}

const VERSION = "v1";

/** AES-256-GCM with the master key. Format: v1.<iv>.<tag>.<ciphertext>, base64url. */
export function createCipher(masterKey: Buffer): Cipher {
  if (masterKey.length !== 32) throw new Error("Master key must be 32 bytes");
  return {
    encrypt(plaintext, purpose) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
      cipher.setAAD(Buffer.from(purpose));
      const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), data]
        .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
        .join(".");
    },
    decrypt(payload, purpose) {
      const [version, iv, tag, data] = payload.split(".");
      if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unknown ciphertext format");
      const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
