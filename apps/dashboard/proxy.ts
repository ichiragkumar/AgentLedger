import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Next 16 file convention: `proxy.ts` replaces the deprecated
// `middleware.ts` (see node_modules/next/dist/docs proxy.md). Protects the
// authenticated dashboard shell; public surface (/, /api/*, auth, onboarding
// entry points, static) stays reachable. Route groups like app/(app) do not
// appear in URLs, so protection is by URL prefix (spec 17 shell sections).

const PROTECTED = [
  "/overview",
  "/agents",
  "/requests",
  "/cache",
  "/routing",
  "/budgets",
  "/policies",
  "/keys",
  "/topology",
  "/settings",
  "/workspace",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const guarded = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (guarded && !req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/api/auth/signin";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
