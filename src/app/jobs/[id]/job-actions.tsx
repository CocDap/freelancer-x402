"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buyerActionAction, finalizeAction } from "../actions";

export type ActionButton = { label: string; run: { type: "buyer"; kind: string } | { type: "finalize" } };

export function JobActions({ jobId, buttons }: { jobId: string; buttons: ActionButton[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function click(b: ActionButton) {
    if (pending) return;
    setError(null);
    setBusy(b.label);
    start(async () => {
      const res = b.run.type === "buyer" ? await buyerActionAction(jobId, b.run.kind) : await finalizeAction(jobId);
      if (!res.ok) setError(res.error);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button key={b.label} type="button" disabled={pending} onClick={() => click(b)} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
            {pending && busy === b.label ? "Đang xử lý..." : b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
