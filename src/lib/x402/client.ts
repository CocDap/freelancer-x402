import "server-only";
import { randomUUID } from "node:crypto";
import type { Address, PrivateKeyAccount } from "viem";
import { formatUnits, parseUnits } from "viem";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";
import { getDb, type Db } from "@/lib/db/client";
import { x402Payment } from "@/lib/db/schema";

export type BudgetReason = "network" | "asset" | "per_call" | "per_search" | "pay_to" | "scheme";

const REASON_MESSAGE: Record<BudgetReason, string> = {
  network: "Mạng thanh toán không khớp, đã từ chối thanh toán.",
  asset: "Token thanh toán không khớp, đã từ chối thanh toán.",
  per_call: "Giá mỗi lần gọi vượt mức tối đa cho phép, đã từ chối thanh toán.",
  per_search: "Tổng chi phí của lần tìm kiếm này sẽ vượt mức tối đa, đã dừng thanh toán.",
  pay_to: "Địa chỉ nhận tiền không được phép, đã từ chối thanh toán.",
  scheme: "Phương thức thanh toán không được hỗ trợ, đã từ chối thanh toán.",
};

/** Thrown before any signature when a 402 requirement breaks a spending rule. */
export class BudgetExceededError extends Error {
  readonly reason: BudgetReason;
  constructor(reason: BudgetReason) {
    super(REASON_MESSAGE[reason]);
    this.name = "BudgetExceededError";
    this.reason = reason;
  }
}

export type PayingFetchOptions = {
  account: PrivateKeyAccount;
  searchId: string;
  maxPerCallUsdc: number;
  maxPerSearchUsdc: number;
  network: string;
  asset: Address;
  /** When set, only requirements paying this address are accepted. */
  payTo?: Address;
  database?: Db;
};

/** Origin + pathname only: the query string may hold user search text. */
function safeUrl(input: RequestInfo | URL): string {
  try {
    const u = new URL(input instanceof Request ? input.url : String(input));
    return u.origin + u.pathname;
  } catch {
    return "unknown";
  }
}

const toAtomic = (usdc: number) => parseUnits(usdc.toFixed(6), 6);

export function createPayingFetch(opts: PayingFetchOptions): { fetch: typeof fetch; spentUsdc(): number } {
  const perCall = toAtomic(opts.maxPerCallUsdc);
  const perSearch = toAtomic(opts.maxPerSearchUsdc);
  let settled = 0n;
  let reserved = 0n; // sum of reservations of all in-flight calls

  function check(req: PaymentRequirements): BudgetReason | null {
    if (req.scheme !== "exact") return "scheme";
    if (req.network !== opts.network) return "network";
    if (req.asset.toLowerCase() !== opts.asset.toLowerCase()) return "asset";
    if (opts.payTo && req.payTo.toLowerCase() !== opts.payTo.toLowerCase()) return "pay_to";
    let amount: bigint;
    try {
      amount = BigInt(req.amount);
    } catch {
      return "per_call";
    }
    if (amount < 0n || amount > perCall) return "per_call";
    if (settled + reserved + amount > perSearch) return "per_search";
    return null;
  }

  async function paidFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let mine = 0n; // this call's reservation
    let budgetError: BudgetExceededError | undefined;

    const client = new x402Client((_version, accepts) => {
      // Release any earlier reservation of this call (retry path) before re-checking.
      reserved -= mine;
      mine = 0n;
      let firstFail: BudgetReason | null = null;
      let best: PaymentRequirements | undefined;
      for (const req of accepts) {
        const fail = check(req);
        if (fail) {
          firstFail ??= fail;
        } else if (!best || BigInt(req.amount) < BigInt(best.amount)) {
          best = req;
        }
      }
      if (!best) {
        budgetError = new BudgetExceededError(firstFail ?? "scheme");
        throw budgetError;
      }
      mine = BigInt(best.amount);
      reserved += mine; // synchronous with the check above: no interleaving
      return best;
    });
    // "*:*" lets every requirement reach the selector so rule failures surface as BudgetExceededError.
    client.register("*:*",new ExactEvmScheme(opts.account as unknown as ClientEvmSigner));
    client.setSpendControls(false); // our selector is the (stricter) spend control

    const release = () => {
      reserved -= mine;
      mine = 0n;
    };
    // Once the payment-signature header leaves the process the seller may settle it.
    let signed = false;
    const lazyFetch: typeof fetch = (i, o) => {
      if (i instanceof Request && (i.headers.has("payment-signature") || i.headers.has("x-payment"))) {
        signed = true;
      }
      return globalThis.fetch(i, o);
    };
    const countAsSpent = () => {
      const amount = mine;
      release();
      settled += amount;
    };
    let res: Response;
    try {
      res = await wrapFetchWithPayment(lazyFetch, client)(input, init);
    } catch (e) {
      if (signed && mine > 0n) countAsSpent();
      else release();
      if (budgetError) throw budgetError;
      if (e instanceof Error && e.message.includes("No network/scheme registered")) {
        throw new BudgetExceededError("scheme");
      }
      throw e;
    }
    if (mine === 0n) return res;

    let settlement: ReturnType<typeof decodePaymentResponseHeader> | undefined;
    try {
      const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
      if (header) settlement = decodePaymentResponseHeader(header);
    } catch {
      settlement = undefined;
    }
    if (settlement?.success) {
      const amount = mine;
      countAsSpent();
      if (res.ok) {
        try {
          await (opts.database ?? getDb()).insert(x402Payment).values({
            id: randomUUID(),
            searchId: opts.searchId,
            url: safeUrl(input),
            amountUsdc: Number(formatUnits(amount, 6)),
            txHash: settlement.transaction || null,
          });
        } catch (e) {
          console.error("x402 payment log failed:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
        }
      }
      return res;
    }
    // Only an explicit rejection (402 + payment-required) proves nothing was settled.
    if (res.status === 402 && res.headers.has("payment-required")) release();
    else if (signed) countAsSpent();
    else release();
    return res;
  }

  return { fetch: paidFetch, spentUsdc: () => Number(formatUnits(settled, 6)) };
}
