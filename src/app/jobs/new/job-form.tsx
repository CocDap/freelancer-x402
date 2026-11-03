"use client";

import { useActionState } from "react";
import { localInputToIso } from "@/lib/jobs/format";
import { createJobAction } from "../actions";
import type { CreateJobState } from "../state";

const input = "rounded border px-3 py-2";

export function JobForm({ candidateUrl }: { candidateUrl: string }) {
  const [state, action, pending] = useActionState<CreateJobState, FormData>(createJobAction, {});
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};

  const err = (m?: string) => (m ? <span role="alert" className="text-sm text-red-600">{m}</span> : null);

  return (
    <form
      action={(fd) => {
        // datetime-local has no zone: convert with the browser's timezone at submit time.
        fd.set("deadlineIso", localInputToIso(String(fd.get("deadline") ?? "")));
        return action(fd);
      }}
      className="flex flex-col gap-3">
      {state.error && (
        <p role="alert" className={state.banner ? "rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" : "text-sm text-red-600"}>
          {state.error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Địa chỉ ví freelancer
        <input name="freelancerAddress" required defaultValue={v.freelancerAddress} placeholder="0x..." className={`${input} font-mono`} />
        {err(fe.freelancerAddress)}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Số tiền (USDC)
        <input name="amountUsdc" required inputMode="decimal" defaultValue={v.amountUsdc} placeholder="100" className={input} />
        {err(fe.amountUsdc)}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Hạn nộp (giờ địa phương của bạn)
        <input
          type="datetime-local"
          name="deadline"
          required
          defaultValue={v.deadline}
          className={input}
        />
        {err(fe.deadline)}
      </label>
      <p className="text-xs text-zinc-500">Có thể nhập số lẻ (vd 0.001 ngày ≈ 86 giây) để thử nghiệm.</p>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Số ngày duyệt
          <input name="reviewDays" type="number" min="0.001" step="any" required defaultValue={v.reviewDays ?? "7"} className={input} />
          {err(fe.reviewDays)}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Số ngày sửa
          <input name="revisionDays" type="number" min="0.001" step="any" required defaultValue={v.revisionDays ?? "3"} className={input} />
          {err(fe.revisionDays)}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Số lần sửa tối đa
          <input name="maxRevisions" type="number" min="0" max="5" step="1" required defaultValue={v.maxRevisions ?? "2"} className={input} />
          {err(fe.maxRevisions)}
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Link ứng viên
        <input name="candidateUrl" type="url" defaultValue={v.candidateUrl ?? candidateUrl} className={input} />
        {err(fe.candidateUrl)}
      </label>
      <button disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
        {pending ? "Đang khoá tiền..." : "Khoá tiền"}
      </button>
    </form>
  );
}
