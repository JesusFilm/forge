import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { DEFAULT_LOCALE, isLocale, parseAcceptLanguage } from "@/lib/locale"

// Matched after Next.js strips `basePath: '/watch'`, so a real
// request for `/watch/foo/en` is matched here as `/foo/en`.
// Locale guard mirrors page.tsx's `isLocale(rawLocale)` precondition.
function isWatchRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length !== 2) return false
  const last = segments[1]
  return last != null && isLocale(last)
}

function applyWatchSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'")
  response.headers.set("Referrer-Policy", "strict-origin")
  return response
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check watch shape first so the response carries CSP headers and is
  // not re-routed by the locale-redirect block below.
  if (isWatchRoute(pathname)) {
    return applyWatchSecurityHeaders(NextResponse.next())
  }

  const segments = pathname.split("/").filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  if (lastSegment && isLocale(lastSegment)) {
    return NextResponse.next()
  }

  const detected = parseAcceptLanguage(request.headers.get("accept-language"))
  if (!detected || detected === DEFAULT_LOCALE) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = `${pathname === "/" ? "" : pathname}/${detected}`
  return NextResponse.redirect(url, 307)
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
}
