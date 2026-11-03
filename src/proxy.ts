import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login$/, /^\/signup$/, /^\/j(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/public(\/|$)/, /^\/api\/x402(\/|$)/];

/** Optimistic check only (cookie presence). The real check is requireUser(). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
