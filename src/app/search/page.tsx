import { connection } from "next/server";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/loading";
import { PageHeader, PageShell } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { SearchForm } from "./search-form";

// An agent run makes several LLM + paid search calls; also applies to the server action used here.
export const maxDuration = 300;

async function Content() {
  await connection();
  await requireUser();
  return <SearchForm />;
}

export default function SearchPage() {
  return (
    <PageShell>
      <PageHeader
        title="Tìm freelancer viết nội dung"
        description="AI tìm hồ sơ trên X, LinkedIn và Threads. Mỗi lần tìm có thể tốn một ít USDC (mạng thử nghiệm)."
      />
      <Suspense fallback={<LoadingBlock rows={4} />}>
        <Content />
      </Suspense>
    </PageShell>
  );
}
