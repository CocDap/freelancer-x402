import {
  concat,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const DAY = 86_400;
/** Mirrors FreelanceEscrow.MIN_WINDOW / MAX_REVISIONS. */
export const MIN_WINDOW_SECONDS = 60;
export const MAX_REVISIONS = 5;
export const USDC_DECIMALS = 6;

export type JobTermsInput = {
  freelancer: Address;
  /** Decimal string, at most 6 fractional digits, e.g. "12.5". */
  amountUsdc: string;
  deliverDeadline: Date;
  reviewDays: number;
  revisionDays: number;
  maxRevisions: number;
  /** Off-chain only: stored in the `job` row. */
  candidateUrl?: string;
};

/** Solidity `FreelanceEscrow.Terms` as viem encodes it. */
export type Terms = {
  freelancer: Address;
  amount: bigint;
  deliverDeadline: bigint;
  reviewWindow: number;
  revisionWindow: number;
  maxRevisions: number;
};

export class TermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsError";
  }
}

function daysToWindow(days: number, label: string): number {
  if (!Number.isFinite(days) || days <= 0) throw new TermsError(`${label} phải là số ngày lớn hơn 0.`);
  const seconds = Math.round(days * DAY);
  if (seconds < MIN_WINDOW_SECONDS) throw new TermsError(`${label} phải dài ít nhất ${MIN_WINDOW_SECONDS} giây.`);
  if (seconds > 0xffffffff) throw new TermsError(`${label} quá dài.`);
  return seconds;
}

/** Addresses that must never be the freelancer (relayer: would let it act as freelancer via direct calls). */
export type ForbiddenFreelancers = { relayer?: Address; escrow?: Address };

/** Validates user input and converts it to on-chain Terms. Throws TermsError (Vietnamese message). */
export function toTerms(input: JobTermsInput, buyer: Address, forbidden: ForbiddenFreelancers = {}): Terms {
  if (typeof input.freelancer !== "string" || !isAddress(input.freelancer, { strict: false })) {
    throw new TermsError("Địa chỉ ví freelancer không hợp lệ.");
  }
  const freelancer = getAddress(input.freelancer);
  if (freelancer === zeroAddress) throw new TermsError("Địa chỉ ví freelancer không được là địa chỉ 0x0.");
  if (freelancer === getAddress(buyer)) {
    throw new TermsError("Ví freelancer không được trùng với ví của người thuê.");
  }
  if (forbidden.relayer && freelancer === getAddress(forbidden.relayer)) {
    throw new TermsError("Ví freelancer không được là ví relayer của hệ thống.");
  }
  if (forbidden.escrow && freelancer === getAddress(forbidden.escrow)) {
    throw new TermsError("Ví freelancer không được là địa chỉ hợp đồng escrow.");
  }

  const raw = String(input.amountUsdc ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new TermsError("Số tiền USDC không hợp lệ.");
  if ((raw.split(".")[1] ?? "").length > USDC_DECIMALS) {
    throw new TermsError(`Số tiền USDC chỉ được có tối đa ${USDC_DECIMALS} chữ số thập phân.`);
  }
  const amount = parseUnits(raw, USDC_DECIMALS);
  if (amount <= 0n) throw new TermsError("Số tiền USDC phải lớn hơn 0.");

  const deadlineMs = input.deliverDeadline instanceof Date ? input.deliverDeadline.getTime() : NaN;
  if (!Number.isFinite(deadlineMs)) throw new TermsError("Hạn giao bài không hợp lệ.");

  if (!Number.isInteger(input.maxRevisions) || input.maxRevisions < 0 || input.maxRevisions > MAX_REVISIONS) {
    throw new TermsError(`Số lần sửa phải là số nguyên từ 0 đến ${MAX_REVISIONS}.`);
  }

  return {
    freelancer,
    amount,
    deliverDeadline: BigInt(Math.floor(deadlineMs / 1000)),
    reviewWindow: daysToWindow(input.reviewDays, "Thời gian duyệt"),
    revisionWindow: daysToWindow(input.revisionDays, "Thời gian sửa"),
    maxRevisions: input.maxRevisions,
  };
}

/** jobId layout required by the contract: buyer address (high 20 bytes) ‖ 12 random bytes. Lowercase hex. */
export function newJobId(buyer: Address): Hex {
  const salt = new Uint8Array(12);
  crypto.getRandomValues(salt);
  return concat([getAddress(buyer), toHex(salt)]).toLowerCase() as Hex;
}

const TERMS_TUPLE = {
  type: "tuple",
  components: [
    { name: "freelancer", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deliverDeadline", type: "uint64" },
    { name: "reviewWindow", type: "uint32" },
    { name: "revisionWindow", type: "uint32" },
    { name: "maxRevisions", type: "uint8" },
  ],
} as const;

/** keccak256(abi.encode(jobId, terms)); equals FreelanceEscrow.jobNonce and is the EIP-3009 nonce. */
export function jobNonce(jobId: Hex, terms: Terms): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, TERMS_TUPLE], [jobId, terms]));
}
