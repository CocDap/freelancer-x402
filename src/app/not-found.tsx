import Link from "next/link";
import { PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageShell size="sm">
      <div className="flex flex-col items-start gap-3">
        <span className="font-mono text-sm text-muted-foreground">404</span>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Không tìm thấy trang</h1>
        <p className="text-sm text-muted-foreground">Link có thể sai, hoặc job này chưa được ghi nhận trên chuỗi.</p>
        <Button asChild variant="outline">
          <Link href="/search">Về trang tìm kiếm</Link>
        </Button>
      </div>
    </PageShell>
  );
}
