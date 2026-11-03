"use client";

import { LockIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useActionState } from "react";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { localInputToIso } from "@/lib/jobs/format";
import { createJobAction } from "../actions";
import type { CreateJobState } from "../state";

export function JobForm({ candidateUrl }: { candidateUrl: string }) {
  const [state, action, pending] = useActionState<CreateJobState, FormData>(createJobAction, {});
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};

  return (
    <Card>
      <form
        action={(fd) => {
          // datetime-local has no zone: convert with the browser's timezone at submit time.
          fd.set("deadlineIso", localInputToIso(String(fd.get("deadline") ?? "")));
          return action(fd);
        }}
        className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>Điều khoản</CardTitle>
          <CardDescription>Ghi lên hợp đồng khi khoá tiền, không sửa được sau đó.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.error && (
            <Alert variant="destructive" className={state.banner ? "border-destructive/40 bg-destructive/10" : undefined}>
              <TriangleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <FormField label="Địa chỉ ví freelancer" htmlFor="freelancerAddress" error={fe.freelancerAddress}>
            <Input
              id="freelancerAddress"
              name="freelancerAddress"
              required
              defaultValue={v.freelancerAddress}
              placeholder="0x..."
              className="font-mono"
              aria-invalid={!!fe.freelancerAddress}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Số tiền (USDC)" htmlFor="amountUsdc" error={fe.amountUsdc}>
              <Input id="amountUsdc" name="amountUsdc" required inputMode="decimal" defaultValue={v.amountUsdc} placeholder="100" aria-invalid={!!fe.amountUsdc} />
            </FormField>
            <FormField label="Hạn nộp (giờ địa phương)" htmlFor="deadline" error={fe.deadline}>
              <Input id="deadline" type="datetime-local" name="deadline" required defaultValue={v.deadline} aria-invalid={!!fe.deadline} />
            </FormField>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Số ngày duyệt" htmlFor="reviewDays" error={fe.reviewDays}>
              <Input id="reviewDays" name="reviewDays" type="number" min="0.001" step="any" required defaultValue={v.reviewDays ?? "7"} aria-invalid={!!fe.reviewDays} />
            </FormField>
            <FormField label="Số ngày sửa" htmlFor="revisionDays" error={fe.revisionDays}>
              <Input id="revisionDays" name="revisionDays" type="number" min="0.001" step="any" required defaultValue={v.revisionDays ?? "3"} aria-invalid={!!fe.revisionDays} />
            </FormField>
            <FormField label="Số lần sửa tối đa" htmlFor="maxRevisions" error={fe.maxRevisions}>
              <Input id="maxRevisions" name="maxRevisions" type="number" min="0" max="5" step="1" required defaultValue={v.maxRevisions ?? "2"} aria-invalid={!!fe.maxRevisions} />
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">Có thể nhập số lẻ (vd 0.001 ngày ≈ 86 giây) để thử nghiệm.</p>

          <FormField label="Link ứng viên" htmlFor="candidateUrl" error={fe.candidateUrl}>
            <Input id="candidateUrl" name="candidateUrl" type="url" defaultValue={v.candidateUrl ?? candidateUrl} aria-invalid={!!fe.candidateUrl} />
          </FormField>
        </CardContent>
        <CardFooter>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <LockIcon />}
            {pending ? "Đang khoá tiền..." : "Khoá tiền"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
