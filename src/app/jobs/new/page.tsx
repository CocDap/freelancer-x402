import { connection } from "next/server";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { JobForm } from "./job-form";

async function Content({ searchParams }: { searchParams: PageProps<"/jobs/new">["searchParams"] }) {
  await connection();
  await requireUser();
  const { candidate } = await searchParams;
  const candidateUrl = typeof candidate === "string" ? candidate : "";
  return <JobForm candidateUrl={candidateUrl} />;
}

export default function NewJobPage(props: PageProps<"/jobs/new">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Thuê freelancer</h1>
      <p className="text-sm text-zinc-600">Tiền USDC được khoá trong hợp đồng escrow; bạn không phải trả phí gas.</p>
      <Suspense fallback={<p>Đang tải...</p>}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
