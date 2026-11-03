import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/lib/env";

const saved = { ...process.env };

beforeEach(() => resetEnvCache());
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("getEnv", () => {
  it("parses valid env", () => {
    process.env.X402_MAX_PER_CALL_USDC = "0.05";
    const env = getEnv();
    expect(env.X402_MAX_PER_CALL_USDC).toBe(0.05);
    expect(typeof env.X402_MAX_PER_SEARCH_USDC).toBe("number");
    expect(Buffer.isBuffer(env.WALLET_ENCRYPTION_KEY)).toBe(true);
    expect(env.WALLET_ENCRYPTION_KEY.length).toBe(32);
    expect(env.DATABASE_AUTH_TOKEN).toBeUndefined();
  });

  it("rejects WALLET_ENCRYPTION_KEY not 32 bytes", () => {
    process.env.WALLET_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => getEnv()).toThrow(/WALLET_ENCRYPTION_KEY/);
  });

  it("rejects missing LLM_BASE_URL", () => {
    delete process.env.LLM_BASE_URL;
    expect(() => getEnv()).toThrow(/LLM_BASE_URL/);
  });
});
