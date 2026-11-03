import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { parseSearchInput, searchHandler } from "@/lib/search/handler";
import { buildSearchRouteConfig, getResourceServer } from "@/lib/x402/server";

type Handler = (request: NextRequest) => Promise<NextResponse>;
let paid: Handler | undefined;

/** withX402 starts facilitator sync when wrapping, so wrap lazily (first valid request), not at import. */
function getPaidHandler(): Handler {
  paid ??= withX402(
    searchHandler,
    // Bare RouteConfig (not a path-pattern map): every request through this wrapper is paid, whatever the path.
    buildSearchRouteConfig(),
    getResourceServer(),
  ) as Handler;
  return paid;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  // Validate BEFORE payment: bad input is never charged and never reaches the x402 wrapper.
  const parsed = parseSearchInput(source, request.nextUrl.searchParams);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return getPaidHandler()(request);
}
