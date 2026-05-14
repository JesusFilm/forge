import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { LANGUAGE_PREFERENCE_COOKIE } from "@/lib/language-preference-constants"
import {
  DEFAULT_LOCALE,
  LOCALE_RESOLVED_PARAM,
  isLocale,
  parseAcceptLanguage,
} from "@/lib/locale"

// Slug shape that the watch picker writes — kebab-case ASCII or bcp47
// codes. Used by both isWatchRoute (to recognise slug-form watch URLs
// like /jesus/english) and the cookie-driven redirect (to validate the
// cookie value is a safe URL segment — defends against open-redirect /
// path traversal via tampered cookies).
const PREFERRED_LANG_SLUG = /^[a-z0-9-]+$/

// Hard length cap on the cookie value. The longest real Arclight
// language slug observed in production is ~50 chars
// ("arabic-modern-standard-egyptian"). 64 leaves margin for new
// additions without admitting pathological values from a tampered
// cookie (e.g. a megabyte-sized string passing the regex).
const PREFERRED_LANG_SLUG_MAX_LEN = 64

// Matched after Next.js strips `basePath: '/watch'`, so a real request
// for `/watch/foo/en` is matched here as `/foo/en`. Recognises both
// bcp47 codes ('en', 'es') and slug-form language identifiers
// ('english', 'spanish', 'arabic-modern-standard') — the watch picker
// navigates with slug-form, so the proxy must treat both as valid watch
// shapes to:
//   (1) apply CSP headers consistently, and
//   (2) skip the Accept-Language redirect for slug-form URLs (which
//       would otherwise produce 3-segment 404s like /jesus/english/es).
function isWatchRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length !== 2) return false
  const last = segments[1]
  if (last == null) return false
  return isLocale(last) || PREFERRED_LANG_SLUG.test(last)
}

function applyWatchSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'")
  response.headers.set("Referrer-Policy", "strict-origin")
  return response
}

// Query params that are deliberate one-shot signals tied to the originating
// request and must NOT be replayed onto the redirected target slug. `?t=<n>`
// is the seek timestamp; valid for the variant the user asked for, not for
// the cookie-preferred one we redirect to. `?autoplay=1` is the gesture-came-
// from-Apply signal; replaying it for receivers of shared links would
// attempt unmuted autoplay without their gesture.
const ONE_SHOT_QUERY_PARAMS = ["autoplay", "t"] as const

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
  // Only fire for watch routes. Otherwise /demo-search/<slug>/<locale> and
  // similar 2-segment paths would receive an unintended cookie redirect.
  if (!isWatchRoute(pathname)) return null
  // `LOCALE_RESOLVED_PARAM` is the page's signal that it has already
  // resolved the URL locale to match the actually-rendered variant
  // (see the watchVideo branch in [slug]/[locale]/page.tsx). Without
  // this bypass the cookie redirect bounces the user back to a locale
  // with no playable variant; the page would loop redirecting forever.
  if (request.nextUrl.searchParams.has(LOCALE_RESOLVED_PARAM)) return null
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
  if (preferredSlug.length > PREFERRED_LANG_SLUG_MAX_LEN) return null
  if (!PREFERRED_LANG_SLUG.test(preferredSlug)) return null
  const segments = pathname.split("/").filter(Boolean)
  const [slug, currentLocale] = segments
  if (!slug || !currentLocale) return null
  if (preferredSlug === currentLocale) return null
  const url = request.nextUrl.clone()
  // basePath '/watch' is auto-prepended; pathname here is post-strip.
  url.pathname = `/${slug}/${preferredSlug}`
  // Drop one-shot signals tied to the originating slug. See
  // ONE_SHOT_QUERY_PARAMS for the rationale.
  for (const param of ONE_SHOT_QUERY_PARAMS) {
    url.searchParams.delete(param)
  }
  return NextResponse.redirect(url, 307)
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Language-preference redirect runs first. It is now scoped to watch
  // routes inside `maybeRedirectToPreferredLanguage`, so non-watch
  // 2-segment paths (e.g. /demo-search/<slug>/<locale>) are unaffected.
  const preferenceRedirect = maybeRedirectToPreferredLanguage(request, pathname)
  if (preferenceRedirect) return preferenceRedirect

  // Apply CSP/Referrer headers for watch routes — both bcp47-form and
  // slug-form (isWatchRoute now recognises both, so slug-form watch URLs
  // also receive the security headers, and they are exempted from the
  // Accept-Language redirect block below).
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
