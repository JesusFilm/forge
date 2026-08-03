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
import {
  asContentSlug,
  asLocaleSlug,
  languageVideosIndexPath,
  watchVideoExplicitLanguagePath,
  watchVideoPath,
} from "@/lib/routes"
import { getWatchHomepageAvailability } from "@/lib/watch-home-route-admission"
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
  isWatchParentAdmittedByNestedContainer,
  isWatchRouteAdmittedByManifest,
  type WatchRouteManifest,
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
      languageHomeSlug?: string
      manifestRoute?: WatchRouteManifestRoute
    }
  | { kind: "pass" }
  | { kind: "not-found" }

type ManifestAdmissionDecision =
  | { kind: "admit"; internalPathname?: string }
  | { kind: "redirect"; pathname: string; status?: 301 | 307 }
  | { kind: "not-found" }

function defaultLanguageVideoAdmission(
  manifest: WatchRouteManifest,
  contentSlug: string,
): Extract<ManifestAdmissionDecision, { kind: "admit" }> | null {
  const defaultAudioLanguageSlug =
    publicWatchAudioLanguageSlugForLocale(DEFAULT_LOCALE)
  if (!defaultAudioLanguageSlug) return null

  const defaultLanguageRoute: WatchRouteManifestRoute = {
    kind: "video",
    contentSlug,
    audioLanguageSlug: defaultAudioLanguageSlug,
  }
  if (!isWatchRouteAdmittedByManifest(manifest, defaultLanguageRoute)) {
    if (
      !isWatchParentAdmittedByNestedContainer(
        manifest,
        contentSlug,
        defaultAudioLanguageSlug,
      )
    ) {
      return null
    }
  }

  return {
    kind: "admit",
    internalPathname: watchVideoExplicitLanguagePath(
      asContentSlug(defaultLanguageRoute.contentSlug),
      asLocaleSlug(defaultLanguageRoute.audioLanguageSlug),
    ),
  }
}

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
  let canonicalPublicPath = publicPath === "/videos" ? "/languages" : publicPath
  if (rest.length === 2) {
    const contentSlug = stripSafeSlug(rest[0] ?? "")
    const audioLanguageSlug = stripSafeSlug(rest[1] ?? "")
    if (
      contentSlug &&
      audioLanguageSlug &&
      isPublicWatchLanguageSlug(audioLanguageSlug)
    ) {
      canonicalPublicPath = watchVideoPath(
        asContentSlug(contentSlug),
        asLocaleSlug(audioLanguageSlug),
      )
    }
  }
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
    const isLanguageHome = isPublicWatchHomeLanguageSlug(slug)
    const identity = isLanguageHome
      ? resolveWatchLocaleIdentity(slug)
      : { locale: DEFAULT_LOCALE, htmlLang: DEFAULT_LOCALE }
    return {
      kind: "rewrite",
      ...identity,
      pathname,
      ...(isLanguageHome ? { languageHomeSlug: slug } : {}),
      manifestRoute: isLanguageHome ? undefined : { kind: "one-segment", slug },
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
  // HTTPS reverse proxies (including Tailscale Serve) can leave Next's dev
  // request URL with an https protocol and a loopback upstream host. Internal
  // rewrites must keep using the actual HTTP loopback listener in development.
  if (
    process.env.NODE_ENV !== "production" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    url.protocol = "http:"
  }
  url.pathname = internalRewritePathname(decision)
  const requestHeaders = new Headers(request.headers)
  // This is an admission claim, not a trusted boolean. If the rewritten URL
  // re-enters the proxy, it is reclassified and compared with this public
  // path before the internal prefix may pass.
  requestHeaders.set(WATCH_INTERNAL_REWRITE_HEADER, decision.pathname)
  return applyWatchSecurityHeaders(
    NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    }),
  )
}

function internalRewritePathname(
  decision: Extract<RewriteDecision, { kind: "rewrite" }>,
): string {
  const pathname = decision.internalPathname ?? decision.pathname
  const suffix = pathname === "/" ? "" : pathname
  return `/${decision.locale}/${decision.htmlLang}${suffix}`
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
  let manifest: WatchRouteManifest | null = null
  if (decision.languageHomeSlug) {
    manifest = await getWatchRouteManifest()
    const manifestAvailability = manifest?.homepageLocales
      ? manifest.homepageLocales.includes(decision.locale)
      : null
    const availability =
      manifestAvailability ??
      (await getWatchHomepageAvailability(decision.locale))

    if (availability === false || availability === "missing") {
      return {
        kind: "redirect",
        pathname: languageVideosIndexPath(
          asLocaleSlug(decision.languageHomeSlug),
        ),
        status: 307,
      }
    }
    // An upstream failure is not proof that a published homepage is absent.
    // Preserve the existing page-level error behavior instead of redirecting.
  }

  if (!decision.manifestRoute) return { kind: "admit" }

  manifest ??= await getWatchRouteManifest()
  if (!manifest) {
    if (
      decision.manifestRoute.kind === "one-segment" &&
      !isOneSegmentCollectionSlug(decision.manifestRoute.slug)
    ) {
      return { kind: "not-found" }
    }
    return { kind: "admit" }
  }

  if (decision.manifestRoute.kind === "one-segment") {
    const { slug } = decision.manifestRoute
    const defaultVideoAdmission = defaultLanguageVideoAdmission(manifest, slug)
    const hasExactVideoLanguages = Object.hasOwn(
      manifest.audioLanguageIndexesByContent ?? {},
      slug,
    )

    // A slug can be published as both an Experience and a Video. Prefer the
    // Video only when the manifest proves its exact language availability;
    // otherwise preserve the one-segment Experience route.
    if (hasExactVideoLanguages) {
      return defaultVideoAdmission ?? { kind: "not-found" }
    }
    if (isWatchRouteAdmittedByManifest(manifest, decision.manifestRoute)) {
      return { kind: "admit" }
    }
    return defaultVideoAdmission ?? { kind: "not-found" }
  }

  if (isWatchRouteAdmittedByManifest(manifest, decision.manifestRoute)) {
    return { kind: "admit" }
  }

  if (
    decision.manifestRoute.kind === "video" &&
    isWatchParentAdmittedByNestedContainer(
      manifest,
      decision.manifestRoute.contentSlug,
      decision.manifestRoute.audioLanguageSlug,
    )
  ) {
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

  return { kind: "not-found" }
}

async function isAdmittedInternalRewrite(
  pathname: string,
  claimedPublicPathname: string,
): Promise<boolean> {
  if (claimedPublicPathname === "/404") {
    return pathname === `/${DEFAULT_LOCALE}/${DEFAULT_LOCALE}/404`
  }
  if (
    !claimedPublicPathname.startsWith("/") ||
    !isSafeCanonicalPath(claimedPublicPathname)
  ) {
    return false
  }
  if (
    canonicalizeWatchPath({ rawPathname: claimedPublicPathname }).kind ===
    "redirect"
  ) {
    return false
  }

  const rewrite = classifyRewrite(claimedPublicPathname)
  if (rewrite.kind !== "rewrite") return false
  const admission = await classifyManifestAdmission(rewrite)
  if (admission.kind !== "admit") return false

  return (
    internalRewritePathname({
      ...rewrite,
      internalPathname: admission.internalPathname ?? rewrite.internalPathname,
    }) === pathname
  )
}

export async function proxy(request: ProxyRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  if (shouldBypassLocaleRewrite(pathname)) return NextResponse.next()

  const claimedPublicPathname = request.headers.get(
    WATCH_INTERNAL_REWRITE_HEADER,
  )
  const prefix = internalPrefixDecision(pathname)
  if (claimedPublicPathname != null) {
    return (await isAdmittedInternalRewrite(pathname, claimedPublicPathname))
      ? applyWatchSecurityHeaders(NextResponse.next())
      : buildNotFound(request)
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
    return buildRedirect(url, admission.status ?? 301)
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
