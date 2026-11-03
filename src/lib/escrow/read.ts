import "server-only";
import { formatUnits, type ContractFunctionReturnType, type Hex } from "viem";
import { escrowAbi } from "@/lib/chain/escrow-abi";
import { resolveChainClients, type ChainDeps } from "@/lib/chain/clients";
import { USDC_DECIMALS } from "./terms";

/** Index = FreelanceEscrow.State. */
export const JOB_STATES = ["None", "Funded", "Submitted", "RevisionRequested", "Released", "Refunded", "Split"] as const;
export type JobStateName = (typeof JOB_STATES)[number];

export type BuyerActionKind = "approve" | "requestRevision" | "refund";
export type FreelancerActionKind = "submit" | "decline";
export type AnyoneActionKind = "claim" | "settleSplit";

export type AvailableActions = {
  buyer: BuyerActionKind[];
  freelancer: FreelancerActionKind[];
  anyone: AnyoneActionKind[];
};

/** FreelanceEscrow.Job as decoded by viem (uint64/uint256 -> bigint, uint8/uint32 -> number). */
export type OnChainJob = ContractFunctionReturnType<typeof escrowAbi, "view", "getJob">;

export type JobView = OnChainJob & {
  jobId: Hex;
  stateName: JobStateName;
  /** amount formatted in USDC units, e.g. "12.5". */
  amountUsdc: string;
  /** block.timestamp of the block the view was read at. */
  now: bigint;
  availableActions: AvailableActions;
};

/**
 * Which actions would currently pass the contract's state/time checks (same inclusive-deadline convention as
 * FreelanceEscrow: the side acting "before" a deadline D may act while now <= D, the other side needs now > D).
 */
export function computeAvailableActions(job: OnChainJob, now: bigint): AvailableActions {
  const actions: AvailableActions = { buyer: [], freelancer: [], anyone: [] };
  switch (JOB_STATES[job.state]) {
    case "Funded":
      if (now <= job.deliverDeadline) actions.freelancer.push("submit");
      actions.freelancer.push("decline");
      if (now > job.deliverDeadline) actions.buyer.push("refund");
      break;
    case "Submitted": {
      const reviewEnd = job.submittedAt + BigInt(job.reviewWindow);
      actions.buyer.push("approve");
      if (now <= reviewEnd && job.revisionCount < job.maxRevisions) actions.buyer.push("requestRevision");
      if (now > reviewEnd) actions.anyone.push("claim");
      break;
    }
    case "RevisionRequested":
      if (now <= job.revisionDeadline) actions.freelancer.push("submit");
      else actions.anyone.push("settleSplit");
      break;
    default:
      break;
  }
  return actions;
}

/** Reads the job at the latest block. Unknown jobIds return a view with stateName "None" and no actions. */
export async function getJob(jobId: Hex, deps: ChainDeps = {}): Promise<JobView> {
  const { publicClient, escrow } = await resolveChainClients(deps);
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const job = await publicClient.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "getJob",
    args: [jobId],
    blockNumber: block.number,
  });
  return {
    ...job,
    jobId,
    stateName: JOB_STATES[job.state] ?? "None",
    amountUsdc: formatUnits(job.amount, USDC_DECIMALS),
    now: block.timestamp,
    availableActions: computeAvailableActions(job, block.timestamp),
  };
}
