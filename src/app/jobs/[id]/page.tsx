import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/components/copy-button";
import { requireUser } from "@/lib/auth";
import { getChainClients } from "@/lib/chain/clients";
import { db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { getJob } from "@/lib/escrow/read";
import {
  BUYER_ACTION_LABELS,
  FINALIZE_LABELS,
  formatChainTime,
  formatUsdc,
  isJobId,
  snowtraceAddress,
  snowtraceTx,
  stateLabel,
} from "@/lib/jobs/format";
import { JobActions, type ActionButton } from "./job-actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-all text-sm">{children}</dd>
    </div>
  );
}

function ExtLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>
  ) : (
    <>{children}</>
  );
}

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

  const buttons: ActionButton[] = [
    ...view.availableActions.buyer.map((kind): ActionButton => ({ label: BUYER_ACTION_LABELS[kind], run: { type: "buyer", kind } })),
    ...view.availableActions.anyone.map((kind): ActionButton => ({ label: FINALIZE_LABELS[kind], run: { type: "finalize" } })),
  ];
  const publicLink = `${getEnv().APP_URL}/j/${jobId}`;
  const reviewDeadline = view.submittedAt > 0n ? view.submittedAt + BigInt(view.reviewWindow) : 0n;

  return (
    <>
      {reconcile ? (
        <p className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">Đang xác nhận / cần đối soát: giao dịch chưa được ghi nhận trên chuỗi.</p>
      ) : (
        <p className="text-lg font-medium">{stateLabel(view.stateName)}</p>
      )}
      <dl className="flex flex-col gap-2">
        <Row label="Số tiền">{view.stateName === "None" ? "—" : `${formatUsdc(view.amount)} USDC`}</Row>
        <Row label="Freelancer">
          <span className="font-mono"><ExtLink href={snowtraceAddress(chainId, row.freelancerAddress)}>{row.freelancerAddress}</ExtLink></span>
        </Row>
        <Row label="Hạn nộp">{formatChainTime(view.deliverDeadline)}</Row>
        <Row label="Nộp bài lúc">{formatChainTime(view.submittedAt)}</Row>
        <Row label="Hạn duyệt">{formatChainTime(reviewDeadline)}</Row>
        <Row label="Hạn sửa">{formatChainTime(view.revisionDeadline)}</Row>
        <Row label="Số lần sửa">{view.stateName === "None" ? "—" : `${view.revisionCount}/${view.maxRevisions}`}</Row>
        <Row label="Link bài">
          {row.contentUrl ? <a href={row.contentUrl} target="_blank" rel="noopener noreferrer" className="underline">{row.contentUrl}</a> : "Chưa có"}
        </Row>
        {row.candidateUrl && (
          <Row label="Link ứng viên"><a href={row.candidateUrl} target="_blank" rel="noopener noreferrer" className="underline">{row.candidateUrl}</a></Row>
        )}
        <Row label="Giao dịch tạo job">
          {row.createTx ? <ExtLink href={snowtraceTx(chainId, row.createTx)}>{row.createTx}</ExtLink> : "—"}
        </Row>
        <Row label="Link công khai">
          <span className="flex flex-wrap items-center gap-2"><span>{publicLink}</span><CopyButton text={publicLink} /></span>
        </Row>
      </dl>
      {buttons.length > 0 && <JobActions jobId={jobId} buttons={buttons} />}
    </>
  );
}

export default function JobPage(props: PageProps<"/jobs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Chi tiết job</h1>
      <Suspense fallback={<p>Đang tải...</p>}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}
