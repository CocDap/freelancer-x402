// EIP-712 definitions for FreelanceEscrow `Action` signatures.
// Shared by the server (relay) and the browser (freelancer page): keep this file free of server imports.
import type { Address, Hex } from "viem";

export const ESCROW_DOMAIN_NAME = "FreelanceEscrow";
export const ESCROW_DOMAIN_VERSION = "1";

/** Mirrors KIND_* constants in FreelanceEscrow.sol. */
export const ActionKind = {
  Submit: 1,
  Approve: 2,
  RequestRevision: 3,
  Refund: 4,
  Decline: 5,
} as const;
export type ActionKindValue = (typeof ActionKind)[keyof typeof ActionKind];

/** `Action(bytes32 jobId,uint8 kind,bytes32 data,uint32 actionNonce,uint256 deadline)` */
export const ACTION_TYPES = {
  Action: [
    { name: "jobId", type: "bytes32" },
    { name: "kind", type: "uint8" },
    { name: "data", type: "bytes32" },
    { name: "actionNonce", type: "uint32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function escrowDomain(chainId: number, escrow: Address) {
  return {
    name: ESCROW_DOMAIN_NAME,
    version: ESCROW_DOMAIN_VERSION,
    chainId,
    verifyingContract: escrow,
  } as const;
}

/**
 * Message for primaryType "Action". `data` is the contentHash for Submit and bytes32 zero for every other kind.
 * `actionNonce` is the job's current on-chain actionNonce (JobView.actionNonce).
 */
export function actionMessage(jobId: Hex, kind: number, data: Hex, actionNonce: number, deadline: bigint) {
  return { jobId, kind, data, actionNonce, deadline };
}
