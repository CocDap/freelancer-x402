"use client";

import { TriangleAlertIcon } from "lucide-react";
import { PageShell } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Generic fallback for unexpected runtime errors. error.message is never rendered: it may carry
// server details (RPC URLs, SQL, ...). Next 16 passes `retry` (re-fetch + re-render) to error boundaries.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageShell>
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Có lỗi xảy ra</AlertTitle>
        <AlertDescription>Không thể tải trang này. Vui lòng thử lại; nếu lỗi vẫn tiếp diễn, hãy quay lại sau.</AlertDescription>
      </Alert>
      <Button className="self-start" onClick={() => retry()}>
        Thử lại
      </Button>
    </PageShell>
  );
}
