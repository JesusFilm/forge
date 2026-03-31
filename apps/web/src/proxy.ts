import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { DEFAULT_LOCALE, isLocale, parseAcceptLanguage } from "@/lib/locale"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Split path into segments: "/easter" → ["easter"], "/easter/fr" → ["easter", "fr"]
  const segments = pathname.split("/").filter(Boolean)

  // If the last segment is already a locale, no redirect needed
  const lastSegment = segments[segments.length - 1]
  if (lastSegment && isLocale(lastSegment)) {
    return NextResponse.next()
  }

  const detected = parseAcceptLanguage(request.headers.get("accept-language"))

  // English (or undetected) → pass through, no redirect
  if (!detected || detected === DEFAULT_LOCALE) {
    return NextResponse.next()
  }

  // Non-English → redirect to locale-explicit URL
  const url = request.nextUrl.clone()
  url.pathname = `${pathname === "/" ? "" : pathname}/${detected}`
  return NextResponse.redirect(url, 307)
}

export const config = {
  matcher: [
    // Match all experience routes, excluding API routes, static assets, and Next.js internals.
    // With basePath: "/watch", these match internal paths (without /watch prefix).
    "/((?!api|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
}
