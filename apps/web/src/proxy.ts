import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { LANGUAGE_PREFERENCE_COOKIE } from "@/lib/language-preference-constants"
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

// Slug shape that the watch picker writes — kebab-case ASCII or bcp47
// codes. Used by the cookie-driven redirect to validate the cookie value
// is a safe URL segment before redirecting (defends against open-redirect
// or path traversal via tampered cookies).
const PREFERRED_LANG_SLUG = /^[a-z0-9-]+$/

// Cookie-driven language preference redirect. Reading the cookie here in
// middleware — instead of in the page Server Component — keeps the page
// route eligible for ISR caching (cookies() in a page silently opts the
// route out of ISR; see docs/solutions/web/nextjs-headers-defeats-route-cache.md).
//
// Trade-off: the proxy doesn't know whether the preferred language has a
// playable variant for this specific video. The previous page-level check
// guarded against redirecting to a non-existent variant; we accept the
// simpler proxy-level redirect because:
//   - Returning users (those with a cookie) are a minority.
//   - When the cookie language has no variant for a given video, the page
//     falls back to the experience template rather than crashing.
//   - The win is significant: most watch-page traffic (no cookie) stays
//     ISR-cached. See also PR #903 which moved locale detection out of
//     the page for the same reason.
function maybeRedirectToPreferredLanguage(
  request: NextRequest,
  pathname: string,
): NextResponse | null {
  const rawCookie = request.cookies.get(LANGUAGE_PREFERENCE_COOKIE)?.value
  if (!rawCookie) return null
  let preferredSlug: string
  try {
    preferredSlug = decodeURIComponent(rawCookie)
  } catch {
    // Cookie value is malformed; ignore the preference.
    return null
  }
  if (!preferredSlug) return null
  if (!PREFERRED_LANG_SLUG.test(preferredSlug)) return null
  // Watch routes are exactly two segments: /<videoSlug>/<localeOrLangSlug>.
  // Accept-Language redirect (below) only fires on non-watch paths, so
  // matching by segment count is enough here.
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length !== 2) return null
  const [slug, currentLocale] = segments
  if (!slug || !currentLocale) return null
  if (preferredSlug === currentLocale) return null
  const url = request.nextUrl.clone()
  // basePath '/watch' is auto-prepended; pathname here is post-strip.
  url.pathname = `/${slug}/${preferredSlug}`
  return NextResponse.redirect(url, 307)
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Language-preference redirect runs first so it fires for both bcp47-
  // form URLs (/jesus/en) and slug-form URLs (/jesus/english). isWatchRoute
  // below is narrower than the real watch surface (it only recognises
  // bcp47 codes), so checking the cookie outside that branch ensures slug-
  // form URLs are covered too.
  const preferenceRedirect = maybeRedirectToPreferredLanguage(request, pathname)
  if (preferenceRedirect) return preferenceRedirect

  // Check watch shape so the response carries CSP headers and is not
  // re-routed by the locale-redirect block below.
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
