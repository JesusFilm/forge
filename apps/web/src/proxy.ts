import { NextResponse } from "next/server"
import { PUBLIC_WATCH_LANGUAGE_SLUGS } from "@forge/watch-url-policy/routes"
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
  SUBTITLE_INTENT_PARAM,
  tryAsLocaleSlug,
  WATCH_SUBTITLE_INTENT_SEGMENT_PREFIX,
  watchSubtitleIntentSegment,
  watchEpisodePath,
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
  isWatchEpisodeRouteExactlyAdmittedByManifest,
  isWatchParentAdmittedByNestedContainer,
  isWatchRouteAdmittedByManifest,
  proveWatchContentAudioLanguageByManifest,
  type WatchRouteManifest,
  type WatchRouteManifestRoute,
} from "@/lib/watch-route-manifest"
import {
  WATCH_INTERNAL_REWRITE_HEADER,
  WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
} from "@/lib/watch-rewrite-headers"

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
const EXPERIENCE_PREVIEW_PREFIX = "/preview/experience/"
const WATCH_UNAVAILABLE_SENTINEL_PATH = "/unavailable/404"
const WATCH_ORDINARY_NOT_FOUND_INTERNAL_PATHS = new Set(
  [DEFAULT_LOCALE, ...PUBLIC_WATCH_LANGUAGE_SLUGS].map((languageSlug) => {
    const { locale, htmlLang } = resolveWatchLocaleIdentity(languageSlug)
    return `/${locale}/${htmlLang}/404`
  }),
)

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
      requiresExactEpisodeAdmission?: boolean
    }
  | { kind: "pass" }
  | { kind: "not-found" }

type ManifestAdmissionDecision =
  | { kind: "admit"; internalPathname?: string }
  | { kind: "redirect"; pathname: string; status?: 301 | 307 }
  | { kind: "known-content-language-gap" }
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

function applyExperiencePreviewHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

function applyOwnerPlaylistHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

function isOwnerPlaylistPath(pathname: string): boolean {
  const segments = splitPath(pathname)
  return (
    (segments.length === 1 && segments[0] === "playlists") ||
    (segments.length === 2 &&
      segments[0] === "playlists" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(segments[1] ?? ""))
  )
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
  if (
    rest.some((segment) =>
      segment.startsWith(WATCH_SUBTITLE_INTENT_SEGMENT_PREFIX),
    )
  ) {
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
  if (rest.length === 3) {
    const parentSlug = stripSafeSlug(rest[0] ?? "")
    const childSlug = stripSafeSlug(rest[1] ?? "")
    const audioLanguageSlug = stripSafeSlug(rest[2] ?? "")
    if (
      parentSlug &&
      childSlug &&
      audioLanguageSlug &&
      isPublicWatchLanguageSlug(audioLanguageSlug)
    ) {
      canonicalPublicPath = watchEpisodePath(
        asContentSlug(parentSlug),
        asContentSlug(childSlug),
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
    if (
      segment === "history" ||
      segment === "languages" ||
      segment === "playlists"
    ) {
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
      slugSegment === "playlists" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/.test(localeSegment ?? "")
    ) {
      return {
        kind: "rewrite",
        locale: DEFAULT_LOCALE,
        htmlLang: DEFAULT_LOCALE,
        pathname,
      }
    }
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
    if (!isPublicWatchLanguageSlug(rawAudioSlug)) {
      const defaultAudioLanguageSlug =
        publicWatchAudioLanguageSlugForLocale(DEFAULT_LOCALE)
      if (!defaultAudioLanguageSlug) return { kind: "not-found" }
      const internalEpisodeSlug =
        resolveLegacyWatchEpisodeAlias(slug, rawAudioSlug) ?? rawAudioSlug
      return {
        kind: "rewrite",
        ...resolveWatchLocaleIdentity(defaultAudioLanguageSlug),
        pathname,
        ...(internalEpisodeSlug !== rawAudioSlug
          ? {
              internalPathname: watchEpisodePath(
                asContentSlug(slug),
                asContentSlug(internalEpisodeSlug),
                asLocaleSlug(defaultAudioLanguageSlug),
              ),
            }
          : {}),
        manifestRoute: {
          kind: "episode",
          parentSlug: slug,
          childSlug: internalEpisodeSlug,
          audioLanguageSlug: defaultAudioLanguageSlug,
        },
        requiresExactEpisodeAdmission: true,
      }
    }
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
  const subtitleLanguageSlug = subtitleIntentForRewrite(request, decision)
  url.pathname = internalRewritePathname(decision, subtitleLanguageSlug)
  const requestHeaders = new Headers(request.headers)
  // This is an admission claim, not a trusted boolean. If the rewritten URL
  // re-enters the proxy, it is reclassified and compared with this public
  // path before the internal prefix may pass.
  requestHeaders.set(WATCH_INTERNAL_REWRITE_HEADER, decision.pathname)
  requestHeaders.delete(WATCH_SUBTITLE_INTENT_REWRITE_HEADER)
  if (subtitleLanguageSlug) {
    requestHeaders.set(
      WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
      subtitleLanguageSlug,
    )
  }
  return applyWatchSecurityHeaders(
    NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    }),
  )
}

function internalRewritePathname(
  decision: Extract<RewriteDecision, { kind: "rewrite" }>,
  subtitleLanguageSlug: ReturnType<typeof tryAsLocaleSlug> = null,
): string {
  const pathname = decision.internalPathname ?? decision.pathname
  const suffix = pathname === "/" ? "" : pathname
  const subtitleSuffix = subtitleLanguageSlug
    ? `/${watchSubtitleIntentSegment(subtitleLanguageSlug)}`
    : ""
  return `/${decision.locale}/${decision.htmlLang}${suffix}${subtitleSuffix}`
}

function subtitleIntentForRewrite(
  request: ProxyRequest,
  decision: Extract<RewriteDecision, { kind: "rewrite" }>,
): ReturnType<typeof tryAsLocaleSlug> {
  const finalRoute = classifyRewrite(
    decision.internalPathname ?? decision.pathname,
  )
  if (
    finalRoute.kind !== "rewrite" ||
    (finalRoute.manifestRoute?.kind !== "video" &&
      finalRoute.manifestRoute?.kind !== "episode")
  ) {
    return null
  }

  const values = request.nextUrl
    .clone()
    .searchParams.getAll(SUBTITLE_INTENT_PARAM)
  if (values.length !== 1) return null
  const subtitleLanguageSlug = tryAsLocaleSlug(values[0] ?? "")
  if (
    !subtitleLanguageSlug ||
    !isPublicWatchLanguageSlug(subtitleLanguageSlug)
  ) {
    return null
  }
  return subtitleLanguageSlug
}

function buildNotFound(
  request: ProxyRequest,
  identity?: Pick<
    Extract<RewriteDecision, { kind: "rewrite" }>,
    "locale" | "htmlLang"
  >,
): NextResponse {
  return rewriteToInternal(request, {
    kind: "rewrite",
    locale: identity?.locale ?? DEFAULT_LOCALE,
    htmlLang: identity?.htmlLang ?? DEFAULT_LOCALE,
    pathname: "/404",
  })
}

function buildUnavailableLanguageNotFound(
  request: ProxyRequest,
  decision: Extract<RewriteDecision, { kind: "rewrite" }>,
): NextResponse {
  return rewriteToInternal(request, {
    ...decision,
    internalPathname: WATCH_UNAVAILABLE_SENTINEL_PATH,
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
    if (decision.requiresExactEpisodeAdmission) {
      return { kind: "not-found" }
    }
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
      if (defaultVideoAdmission) return defaultVideoAdmission
      const defaultAudioLanguageSlug =
        publicWatchAudioLanguageSlugForLocale(DEFAULT_LOCALE)
      if (
        defaultAudioLanguageSlug &&
        proveWatchContentAudioLanguageByManifest(
          manifest,
          slug,
          defaultAudioLanguageSlug,
        ).kind === "known-missing"
      ) {
        return { kind: "known-content-language-gap" }
      }
      return { kind: "not-found" }
    }
    if (isWatchRouteAdmittedByManifest(manifest, decision.manifestRoute)) {
      return { kind: "admit" }
    }
    return defaultVideoAdmission ?? { kind: "not-found" }
  }

  if (
    decision.requiresExactEpisodeAdmission &&
    decision.manifestRoute.kind === "episode"
  ) {
    if (
      isWatchEpisodeRouteExactlyAdmittedByManifest(
        manifest,
        decision.manifestRoute,
      )
    ) {
      return { kind: "admit" }
    }
    // Preserve the legacy duplicate-expansion terminal 404 (`/slug` becomes
    // `/slug.html/slug.html`) instead of turning it into a second redirect.
    if (
      decision.manifestRoute.parentSlug === decision.manifestRoute.childSlug
    ) {
      return { kind: "not-found" }
    }
  } else if (isWatchRouteAdmittedByManifest(manifest, decision.manifestRoute)) {
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

  if (
    decision.manifestRoute.kind === "video" &&
    proveWatchContentAudioLanguageByManifest(
      manifest,
      decision.manifestRoute.contentSlug,
      decision.manifestRoute.audioLanguageSlug,
    ).kind === "known-missing"
  ) {
    return { kind: "known-content-language-gap" }
  }

  return { kind: "not-found" }
}

async function isAdmittedInternalRewrite(
  request: ProxyRequest,
  pathname: string,
  claimedPublicPathname: string,
): Promise<boolean> {
  if (claimedPublicPathname === "/404") {
    return WATCH_ORDINARY_NOT_FOUND_INTERNAL_PATHS.has(pathname)
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
  if (admission.kind === "known-content-language-gap") {
    if (request.headers.get(WATCH_SUBTITLE_INTENT_REWRITE_HEADER) != null) {
      return false
    }
    const unavailableRewrite = {
      ...rewrite,
      internalPathname: WATCH_UNAVAILABLE_SENTINEL_PATH,
    }
    if (subtitleIntentForRewrite(request, unavailableRewrite) != null) {
      return false
    }
    return internalRewritePathname(unavailableRewrite) === pathname
  }
  if (admission.kind !== "admit") return false

  const admittedRewrite = {
    ...rewrite,
    internalPathname: admission.internalPathname ?? rewrite.internalPathname,
  }
  const subtitleLanguageSlug = subtitleIntentForRewrite(
    request,
    admittedRewrite,
  )
  const claimedSubtitleLanguageSlug = request.headers.get(
    WATCH_SUBTITLE_INTENT_REWRITE_HEADER,
  )
  if (claimedSubtitleLanguageSlug !== subtitleLanguageSlug) return false

  return (
    internalRewritePathname(admittedRewrite, subtitleLanguageSlug) === pathname
  )
}

export async function proxy(request: ProxyRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  if (pathname.startsWith(EXPERIENCE_PREVIEW_PREFIX)) {
    return applyExperiencePreviewHeaders(NextResponse.next())
  }

  if (shouldBypassLocaleRewrite(pathname)) return NextResponse.next()

  const claimedPublicPathname = request.headers.get(
    WATCH_INTERNAL_REWRITE_HEADER,
  )
  const prefix = internalPrefixDecision(pathname)
  if (claimedPublicPathname != null) {
    const admitted = await isAdmittedInternalRewrite(
      request,
      pathname,
      claimedPublicPathname,
    )
    if (!admitted) return buildNotFound(request)
    const response = applyWatchSecurityHeaders(NextResponse.next())
    return isOwnerPlaylistPath(claimedPublicPathname)
      ? applyOwnerPlaylistHeaders(response)
      : response
  }

  if (prefix.kind === "not-found") return buildNotFound(request)
  if (prefix.kind === "redirect") {
    const url = request.nextUrl.clone()
    url.pathname = prefix.pathname
    return buildRedirect(url, 308)
  }

  if (pathname === "/history" || isOwnerPlaylistPath(pathname)) {
    const response = rewriteToInternal(request, {
      kind: "rewrite",
      locale: DEFAULT_LOCALE,
      htmlLang: DEFAULT_LOCALE,
      pathname,
    })
    return isOwnerPlaylistPath(pathname)
      ? applyOwnerPlaylistHeaders(response)
      : response
  }
  if (pathname === "/playlists" || pathname.startsWith("/playlists/")) {
    return buildNotFound(request)
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
    return buildNotFound(request, rewrite)
  }
  if (admission.kind === "known-content-language-gap") {
    return buildUnavailableLanguageNotFound(request, rewrite)
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
