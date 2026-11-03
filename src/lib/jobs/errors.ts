// Maps relay/domain errors to UI messages. Server-side only (imports relay error classes).
import { ChainActionError, InsufficientUsdcError, RelayInputError, RelayerUnderfundedError } from "@/lib/escrow/relay";
import { TermsError } from "@/lib/escrow/terms";
import { formatUsdc } from "./format";

export type FieldName =
  | "freelancerAddress"
  | "amountUsdc"
  | "deadline"
  | "reviewDays"
  | "revisionDays"
  | "maxRevisions"
  | "candidateUrl";

export type UiError = { message: string; field?: FieldName; banner?: boolean };

export function termsErrorField(message: string): FieldName | undefined {
  if (/freelancer/i.test(message)) return "freelancerAddress";
  if (/USDC|Số tiền/i.test(message)) return "amountUsdc";
  if (/Hạn giao/i.test(message)) return "deadline";
  if (/Thời gian duyệt/i.test(message)) return "reviewDays";
  if (/Thời gian sửa/i.test(message)) return "revisionDays";
  if (/Số lần sửa/i.test(message)) return "maxRevisions";
  return undefined;
}

export function mapActionError(err: unknown): UiError {
  if (err instanceof TermsError) return { message: err.message, field: termsErrorField(err.message) };
  if (err instanceof InsufficientUsdcError) {
    return {
      message: `Số dư USDC không đủ: có ${formatUsdc(err.have)} USDC, cần ${formatUsdc(err.need)} USDC. Hãy nạp thêm USDC vào ví của bạn.`,
      banner: true,
    };
  }
  if (err instanceof RelayerUnderfundedError) {
    return {
      message: "Ví relayer hết AVAX nên chưa thể trả phí gas. Vui lòng nạp thêm AVAX cho ví relayer rồi thử lại.",
      banner: true,
    };
  }
  if (err instanceof ChainActionError || err instanceof RelayInputError) {
    return { message: err.message, banner: true };
  }
  // Unknown (network, DB...): log without exposing details to the UI.
  console.error("[jobs] unexpected action error:", err instanceof Error ? err.name : typeof err);
  return { message: "Có lỗi không mong muốn. Vui lòng thử lại sau.", banner: true };
}
