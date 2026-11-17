import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const handleI18n = createIntlMiddleware(routing);

/**
 * Optimistic redirect only (better UX). Real authorization happens again in
 * the (app) layout, in every Server Action and in Postgres RLS
 * (see docs/SECURITY.md). Plain path check: Clerk deprecated createRouteMatcher.
 */
// Every signed-in section: a signed-out visitor is sent to sign-in WITH `redirect_url`, so a
// friend link (or any deep link) survives creating an account and lands where it pointed.
const PROTECTED_PATH = new RegExp(
  `^/(${routing.locales.join("|")})/(home|settings|friends|games|library|log|stats|players|plays)(/|$)`,
);

export default clerkMiddleware(async (auth, req) => {
  // API routes (e.g. the Clerk webhook) are not localized: skip next-intl.
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api") || pathname.startsWith("/trpc")) {
    return NextResponse.next();
  }

  if (PROTECTED_PATH.test(pathname)) {
    const { userId } = await auth();
    if (!userId) {
      const locale = pathname.split("/")[1];
      const signIn = new URL(`/${locale}/sign-in`, req.url);
      signIn.searchParams.set("redirect_url", pathname + req.nextUrl.search);
      return NextResponse.redirect(signIn);
    }
  }
  return handleI18n(req);
});

export const config = {
  matcher: [
    // Skip Next.js internals, the self-hosted engines, the model and the reference pack
    // (.wasm, .onnx, .bin ... must not get a locale prefix) and static files
    "/((?!_next|zxing/|models/|ort/|opencv/|reference-pack/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
