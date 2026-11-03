import { connection } from "next/server";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/loading";
import { PageHeader, PageShell } from "@/components/page-header";
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
    <PageShell>
      <PageHeader
        title="Thuê freelancer"
        description="Tiền USDC được khoá trong hợp đồng escrow; bạn không phải trả phí gas."
      />
      <Suspense fallback={<LoadingBlock rows={4} />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </PageShell>
  );
}
