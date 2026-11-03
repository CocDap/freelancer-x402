import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getChainClients } from "@/lib/chain/clients";
import { getDb } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { getJob } from "@/lib/escrow/read";
import { formatChainTime, formatUsdc, isJobId, snowtraceAddress, snowtraceTx, stateLabel } from "@/lib/jobs/format";
import { FreelancerPanel } from "./freelancer-panel";
import { PublicJobProviders } from "./providers";

const DAY = 86_400;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-all text-sm">{children}</dd>
    </div>
  );
}

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

  const actions = view.availableActions;
  const reviewDeadline = view.submittedAt > 0n ? view.submittedAt + BigInt(view.reviewWindow) : 0n;
  const txLink = row?.createTx ? snowtraceTx(chainId, row.createTx) : null;
  const escrowLink = snowtraceAddress(chainId, clients.escrow);

  return (
    <>
      <p className="text-lg font-medium">{PUBLIC_STATE[view.stateName] ?? stateLabel(view.stateName)}</p>
      <dl className="flex flex-col gap-2">
        <Row label="Số tiền đã khoá">{formatUsdc(view.amount)} USDC</Row>
        <Row label="Ví freelancer"><span className="font-mono">{view.freelancer}</span></Row>
        <Row label="Hạn nộp bài">{formatChainTime(view.deliverDeadline)}</Row>
        {view.submittedAt > 0n && <Row label="Hạn người thuê duyệt">{formatChainTime(reviewDeadline)}</Row>}
        {view.stateName === "RevisionRequested" && <Row label="Hạn nộp bản sửa">{formatChainTime(view.revisionDeadline)}</Row>}
        {row?.contentUrl && (
          <Row label="Link bài">
            <a href={row.contentUrl} target="_blank" rel="noopener noreferrer" className="underline">{row.contentUrl}</a>
          </Row>
        )}
        <Row label="Hợp đồng escrow">
          {escrowLink ? <a href={escrowLink} target="_blank" rel="noopener noreferrer" className="underline">{clients.escrow}</a> : <span className="font-mono">{clients.escrow}</span>}
        </Row>
        {txLink && row?.createTx && (
          <Row label="Giao dịch khoá tiền">
            <a href={txLink} target="_blank" rel="noopener noreferrer" className="underline">{row.createTx}</a>
          </Row>
        )}
      </dl>

      <section className="flex flex-col gap-1 rounded bg-zinc-50 p-4 text-sm">
        <h2 className="font-medium">Luật chơi</h2>
        <ul className="list-disc pl-5">
          <li>Người thuê có {days(view.reviewWindow)} ngày để duyệt bài sau khi bạn nộp. Quá hạn mà không duyệt, bạn có thể nhận tiền.</li>
          <li>Nếu người thuê yêu cầu sửa, bạn có {days(view.revisionWindow)} ngày để nộp lại.</li>
          <li>Tối đa {view.maxRevisions} lần yêu cầu sửa (đã dùng {view.revisionCount}).</li>
          <li>Quá hạn sửa thì chia đôi 50/50.</li>
        </ul>
      </section>

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
    </>
  );
}

export default function PublicJobPage(props: PageProps<"/j/[jobId]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Công việc</h1>
      <Suspense fallback={<p>Đang tải...</p>}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}
