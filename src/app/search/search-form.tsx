"use client";

import { ExternalLinkIcon, Loader2Icon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { searchAction } from "./actions";
import type { SearchState } from "./state";

const linkClass = "break-all underline underline-offset-4 hover:text-foreground/80";

function platformOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "x.com" || host === "twitter.com") return "X";
    if (host.endsWith("linkedin.com")) return "LinkedIn";
    if (host === "threads.net" || host === "threads.com") return "Threads";
  } catch {}
  return null;
}

export function SearchForm() {
  const [state, action, pending] = useActionState<SearchState, FormData>(searchAction, {});
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const r = state.result;

  return (
    <>
      <Card>
        <CardContent>
          <form action={action} className="flex flex-col gap-4">
            {state.error && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <FormField label="Chủ đề" htmlFor="topic" error={fe.topic}>
              <Textarea
                id="topic"
                name="topic"
                required
                maxLength={500}
                rows={3}
                defaultValue={v.topic}
                placeholder="Ví dụ: bài blog giới thiệu ví crypto cho người mới"
                aria-invalid={!!fe.topic}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Loại nội dung" htmlFor="contentType" error={fe.contentType}>
                <Input id="contentType" name="contentType" required maxLength={100} defaultValue={v.contentType ?? "Bài blog"} aria-invalid={!!fe.contentType} />
              </FormField>
              <FormField label="Ngôn ngữ" htmlFor="language" error={fe.language}>
                <Input id="language" name="language" required maxLength={50} defaultValue={v.language ?? "Tiếng Việt"} aria-invalid={!!fe.language} />
              </FormField>
            </div>
            <FormField label="Giọng văn (tuỳ chọn)" htmlFor="tone" error={fe.tone}>
              <Input id="tone" name="tone" maxLength={100} defaultValue={v.tone} placeholder="Thân thiện, chuyên nghiệp…" aria-invalid={!!fe.tone} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Ngân sách (USDC, tuỳ chọn)" htmlFor="budgetUsdc" error={fe.budgetUsdc}>
                <Input id="budgetUsdc" name="budgetUsdc" inputMode="decimal" defaultValue={v.budgetUsdc} aria-invalid={!!fe.budgetUsdc} />
              </FormField>
              <FormField label="Hạn (tuỳ chọn)" htmlFor="deadline" error={fe.deadline}>
                <Input id="deadline" name="deadline" type="date" defaultValue={v.deadline} aria-invalid={!!fe.deadline} />
              </FormField>
            </div>
            <Button type="submit" size="lg" disabled={pending} className="self-start">
              {pending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
              {pending ? "Đang tìm…" : "Tìm freelancer"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {r && (
        <section className="flex flex-col gap-4" aria-label="Kết quả tìm kiếm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold">
              {r.candidates.length > 0 ? `${r.candidates.length} ứng viên` : "Kết quả"}
            </h2>
            <span className="font-mono text-xs text-muted-foreground">Đã tiêu {r.spentUsdc} USDC (test)</span>
          </div>
          {r.warnings.map((w) => (
            <Alert key={w} variant="warning" role="status">
              <TriangleAlertIcon />
              <AlertDescription>{w}</AlertDescription>
            </Alert>
          ))}
          {r.candidates.length === 0 && (
            <Card>
              <CardContent className="text-sm text-muted-foreground">
                Không tìm thấy ứng viên phù hợp. Thử mô tả chủ đề rộng hơn hoặc đổi loại nội dung.
              </CardContent>
            </Card>
          )}
          {r.candidates.map((c) => {
            const platform = platformOf(c.profileUrl);
            return (
              <Card key={c.profileUrl}>
                <CardHeader>
                  <CardTitle>{c.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    {c.handle && <span>{c.handle}</span>}
                    <a href={c.profileUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} inline-flex items-center gap-1`}>
                      Xem hồ sơ <ExternalLinkIcon className="size-3" />
                    </a>
                  </CardDescription>
                  {platform && (
                    <CardAction>
                      <Badge variant="secondary">{platform}</Badge>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p>
                    <span className="font-medium">Lý do phù hợp: </span>
                    {c.fitReason}
                  </p>
                  {c.sampleUrls.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">Bài mẫu</span>
                      <ul className="flex flex-col gap-1 pl-4 text-muted-foreground">
                        {c.sampleUrls.map((u) => (
                          <li key={u} className="list-disc">
                            <a href={u} target="_blank" rel="noopener noreferrer" className={linkClass}>{u}</a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {c.risks.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-warning">Rủi ro</span>
                      <ul className="flex flex-col gap-1 pl-4 text-muted-foreground">
                        {c.risks.map((x, i) => <li key={i} className="list-disc">{x}</li>)}
                      </ul>
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button asChild>
                    <Link href={`/jobs/new?candidate=${encodeURIComponent(c.profileUrl)}`}>Thuê người này</Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </section>
      )}
    </>
  );
}
