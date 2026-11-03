"use client";

// Generic fallback for unexpected runtime errors. error.message is never rendered: it may carry
// server details (RPC URLs, SQL, ...). Next 16 passes `retry` (re-fetch + re-render) to error boundaries.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-start gap-3 p-6">
      <h1 className="text-2xl font-semibold">Có lỗi xảy ra</h1>
      <p className="text-sm text-zinc-600">Không thể tải trang này. Vui lòng thử lại; nếu lỗi vẫn tiếp diễn, hãy quay lại sau.</p>
      <button type="button" className="rounded bg-black px-3 py-2 text-white" onClick={() => retry()}>
        Thử lại
      </button>
    </main>
  );
}
