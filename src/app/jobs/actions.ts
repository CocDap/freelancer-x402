"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import type { BuyerActionKind } from "@/lib/escrow/read";
import { JobPendingError, buyerAction, createJob, finalize } from "@/lib/escrow/relay";
import { mapActionError } from "@/lib/jobs/errors";
import { isJobId, isoToDate, sanitizeCandidateUrl } from "@/lib/jobs/format";
import type { ActionResult, CreateJobState } from "./state";

const FIELDS = ["freelancerAddress", "amountUsdc", "deadline", "reviewDays", "revisionDays", "maxRevisions", "candidateUrl"] as const;
const BUYER_KINDS: readonly string[] = ["approve", "requestRevision", "refund"];

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * useActionState-compatible: (prev, formData) -> state. On success it redirects to /jobs/[jobId]
 * (createJob already inserted the job row).
 */
export async function createJobAction(_prev: CreateJobState, formData: FormData): Promise<CreateJobState> {
  const user = await requireUser();
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(formData, k)]));
  values.deadlineIso = str(formData, "deadlineIso");
  const fail = (message: string, field?: (typeof FIELDS)[number], banner?: boolean): CreateJobState => ({
    error: field ? undefined : message,
    banner,
    fieldErrors: field ? { [field]: message } : undefined,
    values,
  });

  const reviewDays = Number(values.reviewDays);
  const revisionDays = Number(values.revisionDays);
  const maxRevisions = Number(values.maxRevisions);
  if (values.reviewDays === "" || Number.isNaN(reviewDays)) return fail("Số ngày duyệt không hợp lệ.", "reviewDays");
  if (values.revisionDays === "" || Number.isNaN(revisionDays)) return fail("Số ngày sửa không hợp lệ.", "revisionDays");
  if (values.maxRevisions === "" || Number.isNaN(maxRevisions)) return fail("Số lần sửa không hợp lệ.", "maxRevisions");
  if (!values.deadlineIso) return fail("Hạn nộp không hợp lệ.", "deadline");

  let jobId: string | undefined;
  let pendingJobId: string | undefined;
  try {
    const res = await createJob(user.id, {
      freelancer: values.freelancerAddress as `0x${string}`,
      amountUsdc: values.amountUsdc,
      deliverDeadline: isoToDate(values.deadlineIso),
      reviewDays,
      revisionDays,
      maxRevisions,
      // Not a validated field in the form: an invalid/over-long link is silently dropped, never stored.
      candidateUrl: sanitizeCandidateUrl(values.candidateUrl) ?? undefined,
    });
    jobId = res.jobId;
  } catch (err) {
    // The tx may already be on its way: never show "retry"; the job page shows the pending / reconcile state.
    if (err instanceof JobPendingError) pendingJobId = err.jobId;
    else {
      const ui = mapActionError(err);
      return fail(ui.message, ui.field, ui.banner);
    }
  }
  redirect(`/jobs/${pendingJobId ?? jobId!}`);
}

async function ownJob(userId: string, jobId: string) {
  if (!isJobId(jobId)) return null;
  const [row] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.id, jobId.toLowerCase()), eq(job.userId, userId)));
  return row ? (row.id as `0x${string}`) : null;
}

/** Buyer approve / requestRevision / refund via the custodial wallet (gasless). */
export async function buyerActionAction(jobId: string, kind: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!BUYER_KINDS.includes(kind)) return { ok: false, error: "Thao tác không hợp lệ." };
  const id = await ownJob(user.id, jobId);
  if (!id) return { ok: false, error: "Không tìm thấy job." };
  try {
    return { ok: true, txHash: await buyerAction(user.id, id, kind as BuyerActionKind) };
  } catch (err) {
    return { ok: false, error: mapActionError(err).message };
  }
}

/** Anyone-can-call finalization (claim after review window, or settleSplit after revision window). */
export async function finalizeAction(jobId: string): Promise<ActionResult> {
  const user = await requireUser();
  const id = await ownJob(user.id, jobId);
  if (!id) return { ok: false, error: "Không tìm thấy job." };
  try {
    return { ok: true, txHash: await finalize(id) };
  } catch (err) {
    return { ok: false, error: mapActionError(err).message };
  }
}
