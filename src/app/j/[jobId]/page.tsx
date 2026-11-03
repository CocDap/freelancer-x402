import { eq } from "drizzle-orm";
import { TriangleAlertIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DetailList, DetailRow, ExtLink } from "@/components/detail-list";
import { JobStatusBadge } from "@/components/job-status-badge";
import { LoadingBlock } from "@/components/loading";
import { PageHeader, PageShell } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getChainClients } from "@/lib/chain/clients";
import { getDb } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { getJob } from "@/lib/escrow/read";
import { CONTENT_MISMATCH_WARNING, contentUrlMatches, formatChainTime, formatUsdc, isJobId, shortHash, snowtraceAddress, snowtraceTx, stateLabel } from "@/lib/jobs/format";
import { FreelancerPanel } from "./freelancer-panel";
import { PublicJobProviders } from "./providers";

const DAY = 86_400;

function days(seconds: number): string {
  return String(Math.round((seconds / DAY) * 100) / 100);
}

// Freelancer-facing wording; the buyer's labels in lib/jobs/format talk to the buyer.
const PUBLIC_STATE: Record<string, string> = {
  Funded: "Đã khoá tiền, chờ bạn nộp bài",
  Submitted: "Đã nộp bài, chờ người thuê duyệt",
  RevisionRequested: "Người thuê yêu cầu sửa, chờ bạn nộp lại",
};

async function Content({ params }: { params: PageProps<"/j/[jobId]">["params"] }) {
  await connection(); // request-time only: reads DB and chain
  const { jobId: rawId } = await params;
  if (!isJobId(rawId)) notFound();
  const jobId = rawId.toLowerCase() as `0x${string}`;

  const [view, clients] = await Promise.all([getJob(jobId), getChainClients()]);
  if (view.stateName === "None") notFound();
  const chainId = clients.chain.id;
  const [row] = await getDb().select().from(job).where(eq(job.id, jobId));

  const contentOk = contentUrlMatches(row?.contentUrl, view.contentHash);
  const actions = view.availableActions;
  const reviewDeadline = view.submittedAt > 0n ? view.submittedAt + BigInt(view.reviewWindow) : 0n;
  const txLink = row?.createTx ? snowtraceTx(chainId, row.createTx) : null;
  const escrowLink = snowtraceAddress(chainId, clients.escrow);

  return (
    <>
      {view.stateName === "Submitted" && !contentOk && (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>{CONTENT_MISMATCH_WARNING}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardDescription>Số tiền đã khoá</CardDescription>
          <CardTitle className="font-mono text-3xl font-semibold tabular-nums">{formatUsdc(view.amount)} USDC</CardTitle>
          <div className="pt-1">
            <JobStatusBadge stateName={view.stateName} label={PUBLIC_STATE[view.stateName] ?? stateLabel(view.stateName)} />
          </div>
        </CardHeader>
        <CardContent>
          <DetailList>
            <DetailRow label="Ví freelancer"><span className="font-mono">{view.freelancer}</span></DetailRow>
            <DetailRow label="Hạn nộp bài">{formatChainTime(view.deliverDeadline)}</DetailRow>
            {view.submittedAt > 0n && <DetailRow label="Hạn người thuê duyệt">{formatChainTime(reviewDeadline)}</DetailRow>}
            {view.stateName === "RevisionRequested" && <DetailRow label="Hạn nộp bản sửa">{formatChainTime(view.revisionDeadline)}</DetailRow>}
            {contentOk && row?.contentUrl && (
              <DetailRow label="Link bài"><ExtLink href={row.contentUrl}>{row.contentUrl}</ExtLink></DetailRow>
            )}
            <DetailRow label="Hợp đồng escrow">
              <span className="font-mono"><ExtLink href={escrowLink}>{clients.escrow}</ExtLink></span>
            </DetailRow>
            {txLink && row?.createTx && (
              <DetailRow label="Giao dịch khoá tiền">
                <span className="font-mono"><ExtLink href={txLink}>{shortHash(row.createTx, 10, 8)}</ExtLink></span>
              </DetailRow>
            )}
          </DetailList>
        </CardContent>
      </Card>

      <PublicJobProviders chainId={chainId}>
        <FreelancerPanel
          jobId={jobId}
          chainId={chainId}
          escrow={clients.escrow}
          freelancer={view.freelancer}
          actionNonce={view.actionNonce}
          stateName={view.stateName}
          canSubmit={actions.freelancer.includes("submit")}
          canDecline={actions.freelancer.includes("decline")}
          canFinalize={actions.anyone.length > 0}
        />
      </PublicJobProviders>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle>Luật chơi</CardTitle>
          <CardDescription>Do hợp đồng escrow thực thi, không ai sửa được.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>Người thuê có {days(view.reviewWindow)} ngày để duyệt bài sau khi bạn nộp. Quá hạn mà không duyệt, bạn có thể nhận tiền.</li>
            <li>Nếu người thuê yêu cầu sửa, bạn có {days(view.revisionWindow)} ngày để nộp lại.</li>
            <li>Tối đa {view.maxRevisions} lần yêu cầu sửa (đã dùng {view.revisionCount}).</li>
            <li>Quá hạn sửa thì chia đôi 50/50.</li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

export default function PublicJobPage(props: PageProps<"/j/[jobId]">) {
  return (
    <PageShell>
      <PageHeader title="Công việc" description="Trang dành cho freelancer. Tiền đã nằm trong escrow trước khi bạn bắt đầu." />
      <Suspense fallback={<LoadingBlock rows={3} />}>
        <Content params={props.params} />
      </Suspense>
    </PageShell>
  );
}
