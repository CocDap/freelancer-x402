import { and, eq } from "drizzle-orm";
import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { zeroHash } from "viem";
import { CopyButton } from "@/components/copy-button";
import { DetailList, DetailRow, ExtLink } from "@/components/detail-list";
import { JobStatusBadge } from "@/components/job-status-badge";
import { LoadingBlock } from "@/components/loading";
import { PageHeader, PageShell } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getChainClients } from "@/lib/chain/clients";
import { db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { getJob } from "@/lib/escrow/read";
import {
  BUYER_ACTION_LABELS,
  CONTENT_MISMATCH_WARNING,
  contentUrlMatches,
  FINALIZE_LABELS,
  formatChainTime,
  formatUsdc,
  isJobId,
  shortHash,
  snowtraceAddress,
  snowtraceTx,
  stateLabel,
} from "@/lib/jobs/format";
import { JobActions, type ActionButton } from "./job-actions";

const DAY = 86_400;

async function Content({ params }: { params: PageProps<"/jobs/[id]">["params"] }) {
  await connection(); // request-time only: reads session, DB and chain
  const user = await requireUser();
  const { id } = await params;
  if (!isJobId(id)) notFound();
  const [row] = await db.select().from(job).where(and(eq(job.id, id.toLowerCase()), eq(job.userId, user.id)));
  if (!row) notFound();

  const jobId = row.id as `0x${string}`;
  const [view, clients] = await Promise.all([getJob(jobId), getChainClients()]);
  const chainId = clients.chain.id;
  const reconcile = view.stateName === "None" && !row.createTx;
  const amount = `${formatUsdc(view.amount)} USDC`;
  const revisionDays = Math.round((view.revisionWindow / DAY) * 100) / 100;

  const BUYER_CONFIRM: Record<keyof typeof BUYER_ACTION_LABELS, Pick<ActionButton, "confirm" | "variant">> = {
    approve: { confirm: `Trả ${amount} cho freelancer. Không hoàn tác được.` },
    requestRevision: {
      confirm: `Freelancer có ${revisionDays} ngày để nộp lại (đã dùng ${view.revisionCount}/${view.maxRevisions} lần sửa). Quá hạn thì chia đôi 50/50.`,
      variant: "outline",
    },
    refund: { confirm: `Hoàn ${amount} về ví của bạn và kết thúc job.`, variant: "destructive" },
  };
  const FINALIZE_CONFIRM: Record<keyof typeof FINALIZE_LABELS, string> = {
    claim: `Quá hạn duyệt: ${amount} được trả cho freelancer.`,
    settleSplit: `Quá hạn sửa: ${amount} được chia đôi giữa bạn và freelancer.`,
  };

  const buttons: ActionButton[] = [
    ...view.availableActions.buyer.map((kind): ActionButton => ({
      label: BUYER_ACTION_LABELS[kind],
      ...BUYER_CONFIRM[kind],
      run: { type: "buyer", kind },
    })),
    ...view.availableActions.anyone.map((kind): ActionButton => ({
      label: FINALIZE_LABELS[kind],
      confirm: FINALIZE_CONFIRM[kind],
      run: { type: "finalize" },
    })),
  ];
  const publicLink = `${getEnv().APP_URL}/j/${jobId}`;
  const contentOk = contentUrlMatches(row.contentUrl, view.contentHash);
  const contentMismatch = view.stateName === "Submitted" && !contentOk;
  const reviewDeadline = view.submittedAt > 0n ? view.submittedAt + BigInt(view.reviewWindow) : 0n;

  return (
    <>
      {reconcile && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>Đang xác nhận / cần đối soát: giao dịch chưa được ghi nhận trên chuỗi.</AlertDescription>
        </Alert>
      )}
      {contentMismatch && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>{CONTENT_MISMATCH_WARNING}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardDescription>Số tiền trong escrow</CardDescription>
          <CardTitle className="font-mono text-3xl font-semibold tabular-nums">
            {view.stateName === "None" ? "—" : amount}
          </CardTitle>
          {!reconcile && (
            <div className="pt-1">
              <JobStatusBadge stateName={view.stateName} label={stateLabel(view.stateName)} />
            </div>
          )}
        </CardHeader>
        <CardContent>
          <DetailList>
            <DetailRow label="Freelancer">
              <span className="font-mono">
                <ExtLink href={snowtraceAddress(chainId, row.freelancerAddress)}>{row.freelancerAddress}</ExtLink>
              </span>
            </DetailRow>
            <DetailRow label="Hạn nộp">{formatChainTime(view.deliverDeadline)}</DetailRow>
            <DetailRow label="Nộp bài lúc">{formatChainTime(view.submittedAt)}</DetailRow>
            <DetailRow label="Hạn duyệt">{formatChainTime(reviewDeadline)}</DetailRow>
            <DetailRow label="Hạn sửa">{formatChainTime(view.revisionDeadline)}</DetailRow>
            <DetailRow label="Số lần sửa">{view.stateName === "None" ? "—" : `${view.revisionCount}/${view.maxRevisions}`}</DetailRow>
            <DetailRow label="Link bài">
              {contentOk && row.contentUrl ? <ExtLink href={row.contentUrl}>{row.contentUrl}</ExtLink> : <span className="text-muted-foreground">Chưa có</span>}
            </DetailRow>
            {view.contentHash !== zeroHash && (
              <DetailRow label="Mã băm bài nộp (on-chain)">
                <span className="font-mono" title={view.contentHash}>{shortHash(view.contentHash)}</span>
              </DetailRow>
            )}
            {row.candidateUrl && (
              <DetailRow label="Link ứng viên"><ExtLink href={row.candidateUrl}>{row.candidateUrl}</ExtLink></DetailRow>
            )}
            <DetailRow label="Giao dịch tạo job">
              {row.createTx ? <span className="font-mono"><ExtLink href={snowtraceTx(chainId, row.createTx)}>{shortHash(row.createTx, 10, 8)}</ExtLink></span> : "—"}
            </DetailRow>
          </DetailList>
        </CardContent>
        {buttons.length > 0 && (
          <CardFooter>
            <JobActions jobId={jobId} buttons={buttons} />
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Link cho freelancer</CardTitle>
          <CardDescription>Gửi link này để freelancer kết nối ví, nộp bài hoặc từ chối.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{publicLink}</code>
          <CopyButton text={publicLink} />
        </CardContent>
      </Card>
    </>
  );
}

export default function JobPage(props: PageProps<"/jobs/[id]">) {
  return (
    <PageShell>
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="self-start text-muted-foreground">
          <Link href="/jobs">
            <ArrowLeftIcon /> Công việc
          </Link>
        </Button>
        <PageHeader title="Chi tiết job" />
      </div>
      <Suspense fallback={<LoadingBlock rows={3} />}>
        <Content params={props.params} />
      </Suspense>
    </PageShell>
  );
}
