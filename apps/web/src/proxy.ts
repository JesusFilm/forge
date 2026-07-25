import { NextResponse } from "next/server"
import {
  DEFAULT_LOCALE,
  isLocale,
  isPublicWatchHomeLanguageSlug,
  isPublicWatchLanguageSlug,
  publicWatchAudioLanguageSlugForLocale,
  resolveUiLocale,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import { asContentSlug, asLocaleSlug, watchVideoPath } from "@/lib/routes"
import { resolveLegacyWatchEpisodeAlias } from "@/lib/watch-route-aliases"
import { canonicalizeWatchPath } from "@/lib/url-canonicalize"
import {
  RESERVED_PREFIXES,
  SAFE_SLUG_PATTERN,
  UNSAFE_PATH_PATTERN,
  hasHtmlSuffix,
  isOneSegmentCollectionSlug,
  isUnsafeRedirectPath,
  stripHtmlSuffix,
} from "@/lib/url-shape"
import {
  getWatchRouteManifest,
  isWatchRouteAdmittedByManifest,
  type WatchRouteManifestRoute,
} from "@/lib/watch-route-manifest"

// Structural subset of `NextRequest` that `proxy()` actually consumes.
// Production `NextRequest` from `next/server` satisfies this shape via
// structural subtyping; tests build this smaller object directly.
export type ProxyRequest = {
  nextUrl: {
    readonly pathname: string
    clone: () => URL
  }
  headers: Headers
}

const REDIRECT_CACHE_CONTROL = "private, max-age=0"
const MAX_PATH_LEN = 2048
const SAFE_PUBLIC_PATH = /^\/[A-Za-z0-9._\-/]+$/
const DEMO_PREFIXES = new Set(["demo-search", "demo-recommendations"])
export const WATCH_INTERNAL_REWRITE_HEADER = "x-forge-watch-internal-rewrite"
const WATCH_INTERNAL_REWRITE_VALUE = "1"

type InternalPrefixDecision =
  | { kind: "none" }
  | { kind: "redirect"; pathname: string }
  | { kind: "not-found" }

type RewriteDecision =
  | {
      kind: "rewrite"
      locale: string
      htmlLang: string
      pathname: string
      internalPathname?: string
      manifestRoute?: WatchRouteManifestRoute
    }
  | { kind: "pass" }
  | { kind: "not-found" }

type ManifestAdmissionDecision =
  | { kind: "admit"; internalPathname?: string }
  | { kind: "redirect"; pathname: string }
  | { kind: "not-found" }

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean)
}

function buildRedirect(url: URL, status: 301 | 307 | 308): NextResponse {
  const response = NextResponse.redirect(url, status)
  response.headers.set("Cache-Control", REDIRECT_CACHE_CONTROL)
  return response
}

function redirectDeprecatedSearch(request: ProxyRequest): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = "/"
  url.searchParams.delete("q")
  return buildRedirect(url, 307)
}

function applyWatchSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'")
  response.headers.set("Referrer-Policy", "strict-origin")
  return response
}

function firstSegment(pathname: string): string | undefined {
  return splitPath(pathname)[0]
}

function shouldBypassLocaleRewrite(pathname: string): boolean {
  const first = firstSegment(pathname)
  return Boolean(
    first && (RESERVED_PREFIXES.has(first) || DEMO_PREFIXES.has(first)),
  )
}

function isSafeCanonicalPath(pathname: string): boolean {
  if (pathname === "/") return true
  if (pathname.length > MAX_PATH_LEN) return false
  if (UNSAFE_PATH_PATTERN.test(pathname)) return false
  if (pathname.split("/").some((segment) => segment === "..")) return false
  return SAFE_PUBLIC_PATH.test(pathname)
}

function stripSafeSlug(segment: string): string | null {
  const stripped = stripHtmlSuffix(segment)
  return SAFE_SLUG_PATTERN.test(stripped) ? stripped : null
}

function internalPrefixDecision(pathname: string): InternalPrefixDecision {
  const segments = splitPath(pathname)
  const [locale, htmlLang, ...rest] = segments
  if (!locale || !isLocale(locale) || hasHtmlSuffix(locale)) {
    return { kind: "none" }
  }

  if (!htmlLang) {
    return { kind: "redirect", pathname: "/" }
  }

  // Only the normalized BCP-47-ish [htmlLang] segment is an internal prefix.
  // Slug-form public URLs such as /en/english must keep flowing through the
  // legacy canonicalizer instead of being de-prefixed to /.
  const identity = resolveWatchLocaleIdentity(htmlLang)
  if (identity.htmlLang !== htmlLang) return { kind: "none" }
  if (identity.locale !== locale || resolveUiLocale(htmlLang) !== locale) {
    return { kind: "not-found" }
  }

  const publicPath = rest.length > 0 ? `/${rest.join("/")}` : "/"
  const canonicalPublicPath =
    publicPath === "/videos" ? "/languages" : publicPath
  if (
    isUnsafeRedirectPath(canonicalPublicPath) ||
    !isSafeCanonicalPath(canonicalPublicPath)
  ) {
    return { kind: "not-found" }
  }
  return { kind: "redirect", pathname: canonicalPublicPath }
}

function classifyRewrite(pathname: string): RewriteDecision {
  if (shouldBypassLocaleRewrite(pathname)) return { kind: "pass" }
  if (pathname === "/" || pathname === "") {
    return {
      kind: "rewrite",
      locale: DEFAULT_LOCALE,
      htmlLang: DEFAULT_LOCALE,
      pathname: "/",
    }
  }
  if (!isSafeCanonicalPath(pathname)) return { kind: "not-found" }

  const segments = splitPath(pathname)
  if (segments.length === 1) {
    const [segment] = segments
    if (segment === "history" || segment === "languages") {
      return {
        kind: "rewrite",
        locale: DEFAULT_LOCALE,
        htmlLang: DEFAULT_LOCALE,
        pathname,
      }
    }
    if (!hasHtmlSuffix(segment)) return { kind: "not-found" }
    const slug = stripSafeSlug(segment)
    if (!slug) return { kind: "not-found" }
    if (isLocale(slug)) return { kind: "not-found" }
    const identity = isPublicWatchHomeLanguageSlug(slug)
      ? resolveWatchLocaleIdentity(slug)
      : { locale: DEFAULT_LOCALE, htmlLang: DEFAULT_LOCALE }
    return {
      kind: "rewrite",
      ...identity,
      pathname,
      manifestRoute: isPublicWatchHomeLanguageSlug(slug)
        ? undefined
        : { kind: "one-segment", slug },
    }
  }

  if (segments.length === 2) {
    const [slugSegment, localeSegment] = segments
    if (
      localeSegment === "videos" ||
      localeSegment === "languages" ||
      localeSegment === "history"
    ) {
      if (!hasHtmlSuffix(slugSegment)) return { kind: "not-found" }
      const rawLanguageSlug = stripSafeSlug(slugSegment)
      if (!rawLanguageSlug) return { kind: "not-found" }
      if (!isPublicWatchLanguageSlug(rawLanguageSlug)) {
        return { kind: "not-found" }
      }
      return {
        kind: "rewrite",
        ...resolveWatchLocaleIdentity(rawLanguageSlug),
        pathname,
        internalPathname:
          localeSegment === "videos"
            ? `/videos/${rawLanguageSlug}`
            : `/${localeSegment}`,
      }
    }
    if (!hasHtmlSuffix(slugSegment) || !hasHtmlSuffix(localeSegment)) {
      return { kind: "not-found" }
    }
    const slug = stripSafeSlug(slugSegment)
    if (!slug) return { kind: "not-found" }
    const rawAudioSlug = stripSafeSlug(localeSegment)
    if (!rawAudioSlug) return { kind: "not-found" }
    if (!isPublicWatchLanguageSlug(rawAudioSlug)) return { kind: "not-found" }
    const identity = resolveWatchLocaleIdentity(rawAudioSlug)
    return {
      kind: "rewrite",
      ...identity,
      pathname,
      manifestRoute: {
        kind: "video",
        contentSlug: slug,
        audioLanguageSlug: rawAudioSlug,
      },
    }
  }

  if (segments.length === 3) {
    const [seriesSegment, episodeSegment, localeSegment] = segments
    if (!hasHtmlSuffix(seriesSegment) || !hasHtmlSuffix(localeSegment)) {
      return { kind: "not-found" }
    }
    const seriesSlug = stripSafeSlug(seriesSegment)
    const episodeSlug = stripSafeSlug(episodeSegment)
    const rawAudioSlug = stripSafeSlug(localeSegment)
    if (!seriesSlug || !episodeSlug || !rawAudioSlug) {
      return { kind: "not-found" }
    }
    if (!isPublicWatchLanguageSlug(rawAudioSlug)) return { kind: "not-found" }
    const identity = resolveWatchLocaleIdentity(rawAudioSlug)
    const internalEpisodeSlug =
      resolveLegacyWatchEpisodeAlias(seriesSlug, episodeSlug) ?? episodeSlug
    return {
      kind: "rewrite",
      ...identity,
      pathname,
      ...(internalEpisodeSlug !== episodeSlug
        ? {
            internalPathname: `/${seriesSegment}/${internalEpisodeSlug}/${localeSegment}`,
          }
        : {}),
      manifestRoute: {
        kind: "episode",
        parentSlug: seriesSlug,
        childSlug: internalEpisodeSlug,
        audioLanguageSlug: rawAudioSlug,
      },
    }
  }

  return { kind: "not-found" }
}

function rewriteToInternal(
  request: ProxyRequest,
  decision: Extract<RewriteDecision, { kind: "rewrite" }>,
): NextResponse {
  const url = request.nextUrl.clone()
  const pathname = decision.internalPathname ?? decision.pathname
  const suffix = pathname === "/" ? "" : pathname
  url.pathname = `/${decision.locale}/${decision.htmlLang}${suffix}`
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(
    WATCH_INTERNAL_REWRITE_HEADER,
    WATCH_INTERNAL_REWRITE_VALUE,
  )
  return applyWatchSecurityHeaders(
    NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    }),
  )
}

function buildNotFound(request: ProxyRequest): NextResponse {
  return rewriteToInternal(request, {
    kind: "rewrite",
    locale: DEFAULT_LOCALE,
    htmlLang: DEFAULT_LOCALE,
    pathname: "/404",
  })
}

async function classifyManifestAdmission(
  decision: Extract<RewriteDecision, { kind: "rewrite" }>,
): Promise<ManifestAdmissionDecision> {
  if (!decision.manifestRoute) return { kind: "admit" }

  const manifest = await getWatchRouteManifest()
  if (!manifest) {
    if (
      decision.manifestRoute.kind === "one-segment" &&
      !isOneSegmentCollectionSlug(decision.manifestRoute.slug)
    ) {
      return { kind: "not-found" }
    }
    return { kind: "admit" }
  }

  if (isWatchRouteAdmittedByManifest(manifest, decision.manifestRoute)) {
    return { kind: "admit" }
  }

  if (decision.manifestRoute.kind === "episode") {
    const standaloneRoute: WatchRouteManifestRoute = {
      kind: "video",
      contentSlug: decision.manifestRoute.childSlug,
      audioLanguageSlug: decision.manifestRoute.audioLanguageSlug,
    }
    if (isWatchRouteAdmittedByManifest(manifest, standaloneRoute)) {
      return {
        kind: "redirect",
        pathname: watchVideoPath(
          asContentSlug(standaloneRoute.contentSlug),
          asLocaleSlug(standaloneRoute.audioLanguageSlug),
        ),
      }
    }
  }

  if (decision.manifestRoute.kind === "one-segment") {
    const defaultAudioLanguageSlug =
      publicWatchAudioLanguageSlugForLocale(DEFAULT_LOCALE)
    if (defaultAudioLanguageSlug) {
      const defaultLanguageRoute: WatchRouteManifestRoute = {
        kind: "video",
        contentSlug: decision.manifestRoute.slug,
        audioLanguageSlug: defaultAudioLanguageSlug,
      }
      if (isWatchRouteAdmittedByManifest(manifest, defaultLanguageRoute)) {
        return {
          kind: "admit",
          internalPathname: watchVideoPath(
            asContentSlug(defaultLanguageRoute.contentSlug),
            asLocaleSlug(defaultLanguageRoute.audioLanguageSlug),
          ),
        }
      }
    }
  }

  return { kind: "not-found" }
}

export async function proxy(request: ProxyRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  if (shouldBypassLocaleRewrite(pathname)) return NextResponse.next()

  const isInternalRewrite =
    request.headers.get(WATCH_INTERNAL_REWRITE_HEADER) ===
    WATCH_INTERNAL_REWRITE_VALUE
  const prefix = internalPrefixDecision(pathname)
  if (isInternalRewrite) {
    if (prefix.kind === "redirect") {
      return applyWatchSecurityHeaders(NextResponse.next())
    }
    if (prefix.kind === "not-found") return buildNotFound(request)
  }

  if (prefix.kind === "not-found") return buildNotFound(request)
  if (prefix.kind === "redirect") {
    const url = request.nextUrl.clone()
    url.pathname = prefix.pathname
    return buildRedirect(url, 308)
  }

  if (pathname === "/history") {
    return rewriteToInternal(request, {
      kind: "rewrite",
      locale: DEFAULT_LOCALE,
      htmlLang: DEFAULT_LOCALE,
      pathname,
    })
  }

  const canonical = canonicalizeWatchPath({ rawPathname: pathname })
  if (canonical.kind === "redirect") {
    const url = request.nextUrl.clone()
    url.pathname = canonical.pathname
    return buildRedirect(url, canonical.status)
  }

  if (pathname === "/search") return redirectDeprecatedSearch(request)

  const rewrite = classifyRewrite(pathname)
  if (rewrite.kind === "pass") return NextResponse.next()
  if (rewrite.kind === "not-found") return buildNotFound(request)
  const admission = await classifyManifestAdmission(rewrite)
  if (admission.kind === "not-found") {
    return buildNotFound(request)
  }
  if (admission.kind === "redirect") {
    const url = request.nextUrl.clone()
    url.pathname = admission.pathname
    return buildRedirect(url, 301)
  }
  return rewriteToInternal(request, {
    ...rewrite,
    internalPathname: admission.internalPathname ?? rewrite.internalPathname,
  })
}

export const config = {
  matcher: [
    // Reserved framework + asset subtrees that must never enter the
    // canonicalize/rewrite pipeline. Demo surfaces live in a route group and
    // keep public paths such as /demo-search without the watch locale rewrite.
    "/((?!(?:api|assets|images|fonts|sitemap|demo-search|demo-recommendations|\\.well-known)(?:/|$)|_next/(?:static|image|data|webpack-hmr)(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap(?:\\.xml)?$).*)",
  ],
}
