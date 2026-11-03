import { NextResponse, type NextRequest } from "next/server";
import { isSource, SearchProviderError, searchSource, type Source } from "@/lib/search/tavily";

const Q_MAX = 200;

/** Validates `source` + `q`. Runs BEFORE any payment is requested. */
export function parseSearchInput(
  source: string,
  searchParams: URLSearchParams,
): { source: Source; q: string } | { error: string } {
  if (!isSource(source)) return { error: "Nguồn không hợp lệ (x, linkedin hoặc threads)." };
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > Q_MAX) return { error: `Từ khóa tìm kiếm phải dài từ 1 đến ${Q_MAX} ký tự.` };
  return { source, q };
}

/** Paid inner handler (wrapped by withX402). The wrapper passes only the request, so source comes from the path. */
export async function searchHandler(request: NextRequest): Promise<NextResponse> {
  const segments = request.nextUrl.pathname.split("/");
  const parsed = parseSearchInput(decodeURIComponent(segments[segments.length - 1] ?? ""), request.nextUrl.searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const hits = await searchSource(parsed.source, parsed.q);
    return NextResponse.json({ hits });
  } catch (err) {
    // Status >= 400 => withX402 does not settle, payer is not charged. Log status only, never bodies/keys.
    console.error("[search] provider failure", err instanceof SearchProviderError ? err.status : "unknown");
    return NextResponse.json({ error: "Nguồn tìm kiếm lỗi, thử lại sau." }, { status: 502 });
  }
}
