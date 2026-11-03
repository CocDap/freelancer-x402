import { connection } from "next/server";
import { Suspense } from "react";
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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Tìm freelancer viết nội dung</h1>
      <p className="text-sm text-zinc-600">
        AI tìm hồ sơ trên X, LinkedIn và Threads. Mỗi lần tìm có thể tốn một ít USDC (mạng thử nghiệm).
      </p>
      <Suspense fallback={<p>Đang tải...</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
