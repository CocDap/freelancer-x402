import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { decryptKey, encryptKey } from "@/lib/wallet/crypto";

const key = randomBytes(32);

describe("wallet crypto", () => {
  it("roundtrip", () => {
    const pk = generatePrivateKey();
    expect(decryptKey(encryptKey(pk, key), key)).toBe(pk);
  });

  it("ciphertext differs per call", () => {
    const pk = generatePrivateKey();
    expect(encryptKey(pk, key)).not.toBe(encryptKey(pk, key));
  });

  it("tampered blob throws", () => {
    const blob = Buffer.from(encryptKey(generatePrivateKey(), key), "base64");
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptKey(blob.toString("base64"), key)).toThrow();
  });

  it("wrong key throws", () => {
    const blob = encryptKey(generatePrivateKey(), key);
    expect(() => decryptKey(blob, randomBytes(32))).toThrow();
  });
});
