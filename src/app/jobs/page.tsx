import { desc, eq } from "drizzle-orm";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { JobStatusBadge } from "@/components/job-status-badge";
import { LoadingBlock } from "@/components/loading";
import { PageHeader, PageShell } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { getJob, type JobView } from "@/lib/escrow/read";
import { formatUsdc, shortHash, stateLabel } from "@/lib/jobs/format";

async function Content() {
  await connection(); // request-time only: reads session, DB and chain
  const user = await requireUser();
  const rows = await db.select().from(job).where(eq(job.userId, user.id)).orderBy(desc(job.createdAt));
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
          Chưa có job nào. Tìm freelancer trước, hoặc tạo job nếu đã có địa chỉ ví của họ.
          <Button asChild size="sm">
            <Link href="/jobs/new">Tạo job mới</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  const views = await Promise.all(
    rows.map((r) => getJob(r.id as `0x${string}`).catch((): JobView | null => null)),
  );
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Freelancer</TableHead>
            <TableHead>Số tiền</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead className="pr-4 text-right">Ngày tạo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const v = views[i];
            const pendingRecon = v?.stateName === "None" && !r.createTx;
            return (
              <TableRow key={r.id} className="relative">
                <TableCell className="pl-4 font-mono">
                  {/* The link covers the whole row so any cell opens the job. */}
                  <Link href={`/jobs/${r.id}`} className="after:absolute after:inset-0" title={r.freelancerAddress}>
                    {shortHash(r.freelancerAddress)}
                  </Link>
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {v && v.stateName !== "None" ? `${formatUsdc(v.amount)} USDC` : "—"}
                </TableCell>
                <TableCell>
                  {!v ? (
                    <Badge variant="destructive">Không đọc được chuỗi</Badge>
                  ) : pendingRecon ? (
                    <Badge variant="warning">Cần đối soát</Badge>
                  ) : (
                    <JobStatusBadge stateName={v.stateName} label={stateLabel(v.stateName)} />
                  )}
                </TableCell>
                <TableCell className="pr-4 text-right text-muted-foreground">
                  {r.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function JobsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Công việc"
        description="Các job đã khoá tiền trong escrow."
        action={
          <Button asChild>
            <Link href="/jobs/new">
              <PlusIcon /> Tạo job
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<LoadingBlock rows={3} />}>
        <Content />
      </Suspense>
    </PageShell>
  );
}
