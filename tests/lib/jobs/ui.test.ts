import { describe, expect, it } from "vitest";
import { ChainActionError, InsufficientUsdcError, RelayerUnderfundedError } from "@/lib/escrow/relay";
import { TermsError } from "@/lib/escrow/terms";
import { mapActionError, termsErrorField } from "@/lib/jobs/errors";
import { formatAvax, formatUsdc, isJobId, isoToDate, localInputToIso, snowtraceAddress, snowtraceTx, stateLabel } from "@/lib/jobs/format";

describe("format", () => {
  it("formats USDC and AVAX", () => {
    expect(formatUsdc(100_000_000n)).toBe("100");
    expect(formatUsdc(1_500_000n)).toBe("1.5");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatAvax(0n)).toBe("0");
    expect(formatAvax(50_000_000_000_000_000n)).toBe("0.05");
    expect(formatAvax(1_234_567_000_000_000_000n)).toBe("1.2345");
  });
  it("labels states in Vietnamese, falling back to the raw name", () => {
    expect(stateLabel("Funded")).toMatch(/khoá tiền/);
    expect(stateLabel("Weird")).toBe("Weird");
  });
  it("snowtrace links only on Fuji", () => {
    expect(snowtraceTx(43113, "0xabc")).toBe("https://testnet.snowtrace.io/tx/0xabc");
    expect(snowtraceAddress(43113, "0xdef")).toBe("https://testnet.snowtrace.io/address/0xdef");
    expect(snowtraceTx(31337, "0xabc")).toBeNull();
    expect(snowtraceAddress(1, "0xdef")).toBeNull();
  });
  it("datetime-local is interpreted as local time and sent as UTC ISO", () => {
    expect(localInputToIso("2026-11-10T10:00")).toBe(new Date(2026, 10, 10, 10, 0).toISOString());
    expect(localInputToIso("")).toBe("");
    expect(localInputToIso("garbage")).toBe("");
  });
  it("isoToDate rejects non-ISO strings", () => {
    expect(isoToDate("2026-11-10T03:00:00.000Z").toISOString()).toBe("2026-11-10T03:00:00.000Z");
    expect(Number.isNaN(isoToDate("").getTime())).toBe(true);
    expect(Number.isNaN(isoToDate("tomorrow").getTime())).toBe(true);
  });
  it("validates jobIds", () => {
    expect(isJobId("0x" + "ab".repeat(32))).toBe(true);
    expect(isJobId("0x1234")).toBe(false);
    expect(isJobId("zz")).toBe(false);
  });
});

describe("mapActionError", () => {
  it("attributes TermsError to fields", () => {
    expect(termsErrorField("Ví freelancer không được trùng với ví của người thuê.")).toBe("freelancerAddress");
    expect(termsErrorField("Số tiền USDC phải lớn hơn 0.")).toBe("amountUsdc");
    expect(termsErrorField("Hạn giao bài phải ở tương lai.")).toBe("deadline");
    expect(termsErrorField("Thời gian duyệt phải là số ngày lớn hơn 0.")).toBe("reviewDays");
    expect(termsErrorField("Thời gian sửa quá dài.")).toBe("revisionDays");
    expect(termsErrorField("Số lần sửa phải là số nguyên từ 0 đến 5.")).toBe("maxRevisions");
    const e = mapActionError(new TermsError("Ví freelancer không được trùng với ví của người thuê."));
    expect(e.field).toBe("freelancerAddress");
    expect(e.banner).toBeUndefined();
  });
  it("shows have/need for insufficient USDC", () => {
    const e = mapActionError(new InsufficientUsdcError(1_500_000n, 20_000_000n));
    expect(e.banner).toBe(true);
    expect(e.message).toContain("có 1.5 USDC");
    expect(e.message).toContain("cần 20 USDC");
  });
  it("maps relayer underfunded, chain errors, and hides unknown errors", () => {
    expect(mapActionError(new RelayerUnderfundedError(0n, 1n)).message).toMatch(/^Ví relayer hết AVAX/);
    const chain = new ChainActionError("BadState", "approve");
    expect(mapActionError(chain)).toEqual({ message: chain.message, banner: true });
    const raw = mapActionError(new Error("viem stack secret 0xdeadbeef"));
    expect(raw.message).not.toContain("secret");
    expect(raw.banner).toBe(true);
  });
});
