import { NextResponse } from "next/server"
import { LANGUAGE_PREFERENCE_COOKIE } from "@/lib/language-preference-constants"
import {
  DEFAULT_LOCALE,
  LOCALE_RESOLVED_PARAM,
  isLocale,
  parseAcceptLanguage,
} from "@/lib/locale"
import { canonicalizeWatchPath } from "@/lib/url-canonicalize"
import {
  getWatchLocaleSegmentIndex,
  hasHtmlSuffix,
  stripHtmlSuffix,
} from "@/lib/url-shape"

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

// Structural subset of `NextRequest` that `proxy()` actually consumes.
// Declaring the precise surface (rather than the full NextRequest type)
// (1) documents the contract, (2) lets the test fixture satisfy the
// signature without a double-cast, and (3) prevents accidental reliance
// on future NextRequest fields that haven't been mocked.
//
// Production `NextRequest` from `next/server` satisfies this shape via
// structural subtyping — no runtime adapter needed.
export type ProxyRequest = {
  nextUrl: {
    readonly pathname: string
    readonly searchParams: { has: (name: string) => boolean }
    clone: () => URL
  }
  cookies: { get: (name: string) => { value: string } | undefined }
  headers: { get: (name: string) => string | null }
}

// Cache-Control emitted on every proxy-issued redirect during the cutover
// window. Prevents Cloudflare / browser caches from pinning a 307/308 to
// a stale legacy URL — every redirect is per-request user-state-dependent
// (cookie) or aliased (canonicalize) and must not be reused across users.
const REDIRECT_CACHE_CONTROL = "private, max-age=0"

function buildRedirect(url: URL, status: 307 | 308): NextResponse {
  const response = NextResponse.redirect(url, status)
  response.headers.set("Cache-Control", REDIRECT_CACHE_CONTROL)
  return response
}

// Matched after Next.js strips `basePath: '/watch'`, so a real request
// for `/watch/foo/en` is matched here as `/foo/en`. Recognises both
// bcp47 codes ('en', 'es') and slug-form language identifiers
// ('english', 'spanish', 'arabic-modern-standard'), in both bare and
// `.html`-suffix shapes (post-Phase-2 canonical):
//   - 2-segment: /{slug}/{locale}              (legacy)
//   - 2-segment: /{slug}.html/{locale}.html    (canonical)
//   - 3-segment: /{series}.html/{episode}/{locale}.html (canonical episode)
//
// CSP headers are applied for both shapes so the watch route policy is
// consistent across legacy + canonical traffic during cutover.
function isWatchRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean)
  const localeIdx = getWatchLocaleSegmentIndex(segments)
  if (localeIdx < 0) return false
  const last = segments[localeIdx]
  if (last == null) return false
  const bare = stripHtmlSuffix(last)
  return isLocale(bare) || PREFERRED_LANG_SLUG.test(bare)
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
// Phase 3: operates on canonical `.html`-shape URLs and supports both
// 2-segment (locale at segments[1]) and 3-segment episode (locale at
// segments[2]) shapes. The locale segment may be `.html`-suffixed; we
// strip the suffix before comparing to the cookie value (which is bare).
//
// Trade-off (unchanged): the proxy doesn't know whether the preferred
// language has a playable variant for this specific video. When the
// cookie language has no variant for a given video, the page falls back
// to the experience template rather than crashing.
function maybeRedirectToPreferredLanguage(
  request: ProxyRequest,
  pathname: string,
): NextResponse | null {
  if (!isWatchRoute(pathname)) return null
  // `LOCALE_RESOLVED_PARAM` is the page's signal that it has already
  // resolved the URL locale to match the actually-rendered variant.
  // Without this bypass the cookie redirect bounces the user back to a
  // locale with no playable variant; the page would loop redirecting.
  if (request.nextUrl.searchParams.has(LOCALE_RESOLVED_PARAM)) return null
  const rawCookie = request.cookies.get(LANGUAGE_PREFERENCE_COOKIE)?.value
  if (!rawCookie) return null
  let preferredSlug: string
  try {
    preferredSlug = decodeURIComponent(rawCookie)
  } catch {
    return null
  }
  if (!preferredSlug) return null
  if (preferredSlug.length > PREFERRED_LANG_SLUG_MAX_LEN) return null
  if (!PREFERRED_LANG_SLUG.test(preferredSlug)) return null
  const segments = pathname.split("/").filter(Boolean)
  const localeIdx = getWatchLocaleSegmentIndex(segments)
  if (localeIdx < 0) return null
  const currentLocaleSeg = segments[localeIdx]
  if (!currentLocaleSeg) return null
  const currentLocaleBare = stripHtmlSuffix(currentLocaleSeg)
  if (preferredSlug === currentLocaleBare) return null
  // Rebuild path preserving the .html-suffix shape of the locale segment.
  const localeHadHtml = hasHtmlSuffix(currentLocaleSeg)
  const newLocaleSeg = localeHadHtml ? `${preferredSlug}.html` : preferredSlug
  const newSegments = segments.slice()
  newSegments[localeIdx] = newLocaleSeg
  const url = request.nextUrl.clone()
  url.pathname = `/${newSegments.join("/")}`
  for (const param of ONE_SHOT_QUERY_PARAMS) {
    url.searchParams.delete(param)
  }
  return buildRedirect(url, 307)
}

export function proxy(request: ProxyRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Step 1: canonicalize legacy /watch shapes into the .html-suffix
  // canonical. Single deterministic pass — six rules with a termination
  // guarantee (canonicalize ∘ canonicalize === canonicalize). Reserved
  // subtrees (api, _next, assets, favicon, robots, sitemap, .well-known)
  // are excluded at the canonicalize level so framework asset URLs are
  // never amplified by Rule 5's single-segment-duplicate rule.
  const canonical = canonicalizeWatchPath({ rawPathname: pathname })
  if (canonical.kind === "redirect") {
    const url = request.nextUrl.clone()
    url.pathname = canonical.pathname
    return buildRedirect(url, canonical.status)
  }

  // Step 2: cookie-driven language preference redirect on canonical
  // shape (.html-aware, 2-seg + 3-seg).
  const preferenceRedirect = maybeRedirectToPreferredLanguage(request, pathname)
  if (preferenceRedirect) return preferenceRedirect

  // Step 3: CSP / Referrer headers for watch routes (both .html and
  // legacy bare 2-segment forms; 3-segment episode shape included).
  if (isWatchRoute(pathname)) {
    return applyWatchSecurityHeaders(NextResponse.next())
  }

  // Step 4: Accept-Language fallback for non-watch shapes. Preserved
  // unchanged from pre-Phase-3 behaviour — fires only when the path does
  // not already terminate in a bcp47 locale segment.
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
  return buildRedirect(url, 307)
}

export const config = {
  matcher: [
    // Reserved framework + asset subtrees that must never enter the
    // canonicalize pipeline (Rule 5's single-segment duplicate would
    // amplify e.g. /assets into /assets.html/assets.html). The matcher
    // is the first line of defense; canonicalize's RESERVED_PREFIXES is
    // the second. Both must agree.
    "/((?!api|_next/static|_next/image|_next/data|_next/webpack-hmr|assets|favicon\\.ico|robots\\.txt|sitemap|\\.well-known).*)",
  ],
}
