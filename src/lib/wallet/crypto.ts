import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Hex } from "viem";

const IV_LEN = 12;
const TAG_LEN = 16;

/** AES-256-GCM. Returns base64(iv | tag | ciphertext). */
export function encryptKey(pk: Hex, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(pk, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptKey(blob: string, key: Buffer): Hex {
  const buf = Buffer.from(blob, "base64");
  if (buf.length <= IV_LEN + TAG_LEN) throw new Error("Invalid encrypted key blob");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8") as Hex;
}
