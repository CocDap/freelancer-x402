import { describe, expect, it } from "vitest";
import { toAtomicUsdc } from "@/lib/x402/server";

describe("toAtomicUsdc", () => {
  it("converts with exact decimal math", () => {
    expect(toAtomicUsdc(0.01)).toBe("10000");
    expect(toAtomicUsdc(0.1)).toBe("100000");
    expect(toAtomicUsdc(0.07)).toBe("70000");
    expect(toAtomicUsdc(1)).toBe("1000000");
    expect(toAtomicUsdc(0.000001)).toBe("1");
    expect(toAtomicUsdc(1.15)).toBe("1150000");
  });
  it("rejects prices that round to zero", () => {
    expect(() => toAtomicUsdc(0)).toThrow();
    expect(() => toAtomicUsdc(0.0000001)).toThrow();
  });
});
