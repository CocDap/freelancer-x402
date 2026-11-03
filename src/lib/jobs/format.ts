// Pure, client-safe helpers for the buyer UI.
import { formatUnits } from "viem";
import { USDC_DECIMALS } from "@/lib/escrow/terms";

export function formatUsdc(units: bigint): string {
  return formatUnits(units, USDC_DECIMALS);
}

export function formatAvax(wei: bigint, maxDecimals = 4): string {
  const [int, frac = ""] = formatUnits(wei, 18).split(".");
  const cut = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return cut ? `${int}.${cut}` : int;
}

const STATE_LABELS: Record<string, string> = {
  None: "Chưa có trên chuỗi",
  Funded: "Đã khoá tiền, chờ freelancer nộp bài",
  Submitted: "Đã nộp bài, chờ bạn duyệt",
  RevisionRequested: "Đã yêu cầu sửa, chờ freelancer nộp lại",
  Released: "Đã thanh toán cho freelancer",
  Refunded: "Đã hoàn tiền",
  Split: "Đã chia tiền",
};

export function stateLabel(stateName: string): string {
  return STATE_LABELS[stateName] ?? stateName;
}

export const BUYER_ACTION_LABELS = {
  approve: "Duyệt",
  requestRevision: "Yêu cầu sửa",
  refund: "Hoàn tiền",
} as const;

export const FINALIZE_LABELS = {
  claim: "Hoàn tất",
  settleSplit: "Hoàn tất",
} as const;

/** Snowtrace links exist only for Avalanche Fuji (43113); other chains get no link. */
export function snowtraceTx(chainId: number, hash: string): string | null {
  return chainId === 43113 ? `https://testnet.snowtrace.io/tx/${hash}` : null;
}

export function snowtraceAddress(chainId: number, address: string): string | null {
  return chainId === 43113 ? `https://testnet.snowtrace.io/address/${address}` : null;
}

export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";

/** Unix seconds (bigint) -> display string in Vietnam time; "—" for 0. */
export function formatChainTime(seconds: bigint): string {
  if (seconds <= 0n) return "—";
  return new Date(Number(seconds) * 1000).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }) + " (GMT+7)";
}

/**
 * `<input type="datetime-local">` yields "YYYY-MM-DDTHH:mm" with no zone. The browser parses it as the user's local
 * time; we send the resulting UTC ISO string to the server so the server timezone never matters.
 */
export function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Server side: ISO string -> Date (Invalid Date if malformed, which toTerms rejects). */
export function isoToDate(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? new Date(iso) : new Date(NaN);
}

export function isJobId(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
