import { NextResponse } from "next/server"
import { DEFAULT_LOCALE, isLocale, parseAcceptLanguage } from "@/lib/locale"
import { WATCH_PATHNAME_HEADER } from "@/lib/proxy-headers"
import { canonicalizeWatchPath } from "@/lib/url-canonicalize"
import {
  SAFE_SLUG_PATTERN,
  getWatchLocaleSegmentIndex,
  stripHtmlSuffix,
} from "@/lib/url-shape"

// `SAFE_SLUG_PATTERN` (kebab-case ASCII, from url-shape.ts) recognises
// slug-form watch URLs (`/jesus/english`) in isWatchRoute so the security
// headers + WATCH_PATHNAME_HEADER are applied to both bcp47 and slug-form
// locale segments.

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
    clone: () => URL
  }
  // Real `Headers` (not just `{ get }`) because `nextWithPathname` forwards
  // the inbound headers via `new Headers(request.headers)` for the
  // WATCH_PATHNAME_HEADER contract. Production `NextRequest.headers` is a
  // `Headers`; the test fixture builds a real `Headers` too.
  headers: Headers
}

// Cache-Control emitted on every proxy-issued redirect during the cutover
// window. Prevents Cloudflare / browser caches from pinning a 307/308 to
// a stale legacy URL — redirects are alias normalizations (canonicalize) or
// Accept-Language appends and must not be reused indiscriminately.
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

  // Step 2: CSP / Referrer headers for watch routes (both .html and
  // legacy bare 2-segment forms; 3-segment episode shape included).
  //
  // NOTE: there is deliberately NO cookie-driven language redirect here.
  // The URL is the sole locale carrier (see apps/web/CLAUDE.md "i18n").
  // A stale `forge_watch_lang` cookie must NEVER override an explicit
  // locale already named in the path — doing so hijacked canonical /
  // shared / SEO links (e.g. `/jesus.html/english.html` → cookie's
  // language) and was the cause of the production redirect bug.
  if (isWatchRoute(pathname)) {
    return applyWatchSecurityHeaders(nextWithPathname(request, pathname))
  }

  // Step 3: Accept-Language fallback. Post-Phase-3 this serves a NARROW
  // surface: canonicalize (Step 1) already redirects every 1-seg bare slug
  // (Rule 5) and 2-seg bare pair (Rule 4), and canonical `.html` watch
  // shapes exit at Step 3. What survives to here: the root `/`, the
  // 1-segment exempt routes (`/videos`, `/search`), 4+ segment paths, and
  // percent-encoded / non-ASCII paths the canonicalize allowlist rejected.
  // (Canonical `.html` watch shapes already exited at Step 2.) For those, if
  // the path doesn't already terminate in a bcp47 locale, append the
  // Accept-Language-detected locale.
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
