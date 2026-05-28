import { NextResponse } from "next/server"
import { LANGUAGE_PREFERENCE_COOKIE } from "@/lib/language-preference-constants"
import {
  DEFAULT_LOCALE,
  LOCALE_RESOLVED_PARAM,
  isLocale,
  parseAcceptLanguage,
} from "@/lib/locale"
import { WATCH_PATHNAME_HEADER } from "@/lib/proxy-headers"
import { canonicalizeWatchPath } from "@/lib/url-canonicalize"
import {
  SAFE_SLUG_PATTERN,
  getWatchLocaleSegmentIndex,
  isUnsafeRedirectPath,
  stripHtmlSuffix,
} from "@/lib/url-shape"

// `SAFE_SLUG_PATTERN` (kebab-case ASCII, from url-shape.ts) is the
// language-slug validator here: it recognises slug-form watch URLs
// (`/jesus/english`) in isWatchRoute and validates the language-preference
// cookie value before it lands in a redirect Location (defends against
// open-redirect / path traversal via a tampered cookie).

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
  // Real `Headers` (not just `{ get }`) because `nextWithPathname` forwards
  // the inbound headers via `new Headers(request.headers)` for the
  // WATCH_PATHNAME_HEADER contract. Production `NextRequest.headers` is a
  // `Headers`; the test fixture builds a real `Headers` too.
  headers: Headers
}

// Cache-Control emitted on every proxy-issued redirect during the cutover
// window. Prevents Cloudflare / browser caches from pinning a 307/308 to
// a stale legacy URL — every redirect is per-request user-state-dependent
// (cookie) or aliased (canonicalize) and must not be reused across users.
const REDIRECT_CACHE_CONTROL = "private, max-age=0"

// Note: CSP / Referrer headers (applyWatchSecurityHeaders) are intentionally
// NOT applied to redirects. Browsers ignore CSP on 3xx responses — the policy
// attaches to the terminal 200 the redirect lands on. Don't "fix" the apparent
// gap by wrapping buildRedirect in applyWatchSecurityHeaders.
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
  return isLocale(bare) || SAFE_SLUG_PATTERN.test(bare)
}

function applyWatchSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'")
  response.headers.set("Referrer-Policy", "strict-origin")
  return response
}

// Forward the watch URL pathname to the root layout via WATCH_PATHNAME_HEADER.
// Layouts render BEFORE pages in App Router; without this header, the layout
// has no way to know the URL when it needs to derive UI chrome locale for
// `<html lang>` + NextIntlClientProvider. Pages also call setRequestLocale
// defensively, but the layout's getLocale() runs first and would otherwise
// see the default locale every render.
//
// Defense-in-depth: `headers.delete()` before `set()` strips any inbound
// client-supplied value. `Headers.set` already overwrites, so this is
// belt-and-braces — the actual safety net against header spoofing is the
// `resolveUiLocale` + `hasUiLocale` gate in app/layout.tsx (a spoofed
// pathname that doesn't classify to a valid locale falls through to
// DEFAULT_LOCALE). See `apps/web/src/lib/proxy-headers.ts` for the contract.
function nextWithPathname(
  request: ProxyRequest,
  pathname: string,
): NextResponse {
  const headers = new Headers(request.headers)
  headers.delete(WATCH_PATHNAME_HEADER)
  headers.set(WATCH_PATHNAME_HEADER, pathname)
  return NextResponse.next({ request: { headers } })
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
  if (!SAFE_SLUG_PATTERN.test(preferredSlug)) return null
  const segments = pathname.split("/").filter(Boolean)
  const localeIdx = getWatchLocaleSegmentIndex(segments)
  if (localeIdx < 0) return null
  const currentLocaleSeg = segments[localeIdx]
  if (!currentLocaleSeg) return null
  const currentLocaleBare = stripHtmlSuffix(currentLocaleSeg)
  if (preferredSlug === currentLocaleBare) return null
  // The locale segment is always `.html`-suffixed here: proxy() runs
  // canonicalize (Rule 4 appends `.html` to bare locale segments on 2-seg
  // and 3-seg watch paths) BEFORE this cookie redirect, so any path that
  // reaches here in canonical form has a `.html` locale. Build the new
  // segment with the suffix unconditionally.
  const newSegments = segments.slice()
  newSegments[localeIdx] = `${preferredSlug}.html`
  const url = request.nextUrl.clone()
  const candidatePathname = `/${newSegments.join("/")}`
  // Defense-in-depth: the cookie value is regex-clean, but the OTHER
  // segments (slug, episode) pass through unsanitized from the request
  // pathname. Run the same output-shape guard canonicalize applies to its
  // synthesized Location before emitting a redirect.
  if (isUnsafeRedirectPath(candidatePathname)) return null
  url.pathname = candidatePathname
  for (const param of ONE_SHOT_QUERY_PARAMS) {
    url.searchParams.delete(param)
  }
  const response = buildRedirect(url, 307)
  // This redirect target depends on the language-preference cookie. Without
  // `Vary: Cookie`, any shared cache that ignores `private`/`max-age=0`
  // (a mis-set Cloudflare transform rule, a corporate proxy) could serve
  // one user's locale to another. Canonicalize redirects are NOT
  // cookie-dependent, so they don't carry this header.
  response.headers.set("Vary", "Cookie")
  return response
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
    return applyWatchSecurityHeaders(nextWithPathname(request, pathname))
  }

  // Step 4: Accept-Language fallback. Post-Phase-3 this serves a NARROW
  // surface: canonicalize (Step 1) already redirects every 1-seg bare slug
  // (Rule 5) and 2-seg bare pair (Rule 4), and canonical `.html` watch
  // shapes exit at Step 3. What survives to here: the root `/`, the
  // 1-segment exempt routes (`/videos`, `/search`), 4+ segment paths, and
  // percent-encoded / non-ASCII paths the canonicalize allowlist rejected.
  // For those, if the path doesn't already terminate in a bcp47 locale, we
  // append the Accept-Language-detected locale. (Phase 4 may retire this
  // once route-level locale detection fully owns non-watch paths.)
  const segments = pathname.split("/").filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  if (lastSegment && isLocale(lastSegment)) {
    return nextWithPathname(request, pathname)
  }

  const detected = parseAcceptLanguage(request.headers.get("accept-language"))
  if (!detected || detected === DEFAULT_LOCALE) {
    return nextWithPathname(request, pathname)
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
