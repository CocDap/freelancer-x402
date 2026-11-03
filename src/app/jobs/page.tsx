import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { getJob, type JobView } from "@/lib/escrow/read";
import { formatUsdc, stateLabel } from "@/lib/jobs/format";

async function Content() {
  await connection(); // request-time only: reads session, DB and chain
  const user = await requireUser();
  const rows = await db.select().from(job).where(eq(job.userId, user.id)).orderBy(desc(job.createdAt));
  if (rows.length === 0) {
    return (
      <p className="text-sm">
        Chưa có job nào. <Link href="/jobs/new" className="underline">Tạo job mới</Link>
      </p>
    );
  }
  const views = await Promise.all(
    rows.map((r) => getJob(r.id as `0x${string}`).catch((): JobView | null => null)),
  );
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const v = views[i];
        const pendingRecon = v?.stateName === "None" && !r.createTx;
        const status = !v ? "Không đọc được trạng thái chuỗi" : pendingRecon ? "Đang xác nhận / cần đối soát" : stateLabel(v.stateName);
        return (
          <li key={r.id} className="rounded border p-3">
            <Link href={`/jobs/${r.id}`} className="flex flex-col gap-1">
              <span className="break-all font-mono text-sm">{r.freelancerAddress}</span>
              <span className="text-sm">
                {v && v.stateName !== "None" ? `${formatUsdc(v.amount)} USDC · ` : ""}
                {status}
              </span>
              <span className="text-xs text-zinc-500">{r.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function JobsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Công việc</h1>
        <Link href="/jobs/new" className="rounded bg-black px-3 py-2 text-sm text-white">Tạo job</Link>
      </div>
      <Suspense fallback={<p>Đang tải...</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
