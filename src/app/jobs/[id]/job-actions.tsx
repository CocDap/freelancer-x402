"use client";

import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { buyerActionAction, finalizeAction } from "../actions";

export type ActionButton = {
  label: string;
  /** Shown in the confirm dialog: what the on-chain action does with the money. */
  confirm: string;
  variant?: "default" | "outline" | "destructive";
  run: { type: "buyer"; kind: string } | { type: "finalize" };
};

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
      if (res.ok) toast.success(`${b.label}: đã gửi giao dịch`);
      else setError(res.error);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <AlertDialog key={b.label}>
            <AlertDialogTrigger asChild>
              <Button variant={b.variant ?? "default"} disabled={pending}>
                {pending && busy === b.label && <Loader2Icon className="animate-spin" />}
                {pending && busy === b.label ? "Đang xử lý..." : b.label}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{b.label}?</AlertDialogTitle>
                <AlertDialogDescription>{b.confirm}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Huỷ</AlertDialogCancel>
                <AlertDialogAction variant={b.variant === "destructive" ? "destructive" : "default"} onClick={() => click(b)}>
                  Xác nhận
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ))}
      </div>
    </div>
  );
}
