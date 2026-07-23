import {
  WATCH_BASE_PATH,
  WATCH_CANONICAL_ORIGIN,
  WATCH_PUBLIC_METADATA_ORIGIN,
  parseWatchPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  type ParsedWatchPath,
} from "./routes"
import { hasHtmlSuffix, isOneSegmentCollectionSlug } from "./url-shape"

export const WATCH_HOME_SECTION_CTA_ACTION = "watch_home.section_cta_clicked"

export type ExperienceSurface = "watch-home"

type WatchHomeCtaRouteKind =
  | ParsedWatchPath["kind"]
  | "one-segment-collection"
  | "site"
  | "external"

type ClassifiedHref = {
  href: string
  destination: string
  routeKind: WatchHomeCtaRouteKind
}

const PUBLIC_SITE_HOSTNAMES = new Set([
  new URL(WATCH_PUBLIC_METADATA_ORIGIN).hostname,
  new URL(WATCH_CANONICAL_ORIGIN).hostname,
  "jesusfilm.org",
])
const URL_PARSE_BASE = `${WATCH_PUBLIC_METADATA_ORIGIN}/`
const MAX_SECTION_KEY_LENGTH = 80
const UNSAFE_ENCODED_HREF_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i

function hasUnsafeHrefCharacters(href: string): boolean {
  for (const character of href) {
    const codePoint = character.codePointAt(0) ?? 0
    if (character === "\\" || codePoint < 0x20 || codePoint === 0x7f) {
      return true
    }
  }
  return UNSAFE_ENCODED_HREF_PATTERN.test(href)
}

function isCanonicalWatchPath(
  pathname: string,
  parsed: ParsedWatchPath,
): boolean {
  const segments = pathname.split("/").filter(Boolean)
  if (pathname !== `/${segments.join("/")}`) return false

  switch (parsed.kind) {
    case "languages":
      return pathname === "/languages"
    case "history":
      return pathname === "/history"
    case "localized-languages":
    case "localized-history":
    case "language-videos":
      return (
        segments.length === 2 &&
        hasHtmlSuffix(segments[0]) &&
        tryAsLocaleSlug(parsed.lang) != null
      )
    case "video":
      return (
        segments.length === 2 &&
        hasHtmlSuffix(segments[0]) &&
        hasHtmlSuffix(segments[1]) &&
        tryAsContentSlug(parsed.slug) != null &&
        tryAsLocaleSlug(parsed.lang) != null
      )
    case "episode":
      return (
        segments.length === 3 &&
        hasHtmlSuffix(segments[0]) &&
        !hasHtmlSuffix(segments[1]) &&
        hasHtmlSuffix(segments[2]) &&
        tryAsContentSlug(parsed.series) != null &&
        tryAsContentSlug(parsed.episode) != null &&
        tryAsLocaleSlug(parsed.lang) != null
      )
    case "home":
    case "localized-home":
    case "search":
    case "reserved":
    case "unknown":
      return false
  }
}

function classifyWatchHomeCtaHref(
  value: string | null | undefined,
): ClassifiedHref | null {
  const href = value?.trim() ?? ""
  if (
    href.length === 0 ||
    href === "/" ||
    href.startsWith("?") ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    hasUnsafeHrefCharacters(href)
  ) {
    return null
  }

  const isAbsolute = /^https?:\/\//i.test(href)
  if (!href.startsWith("/") && !isAbsolute) {
    return null
  }

  let url: URL
  try {
    url = new URL(href, URL_PARSE_BASE)
  } catch {
    return null
  }

  const isPublicSite = PUBLIC_SITE_HOSTNAMES.has(url.hostname)
  if (!isAbsolute && !isPublicSite) {
    return null
  }
  if (isAbsolute && !isPublicSite) {
    return {
      href,
      destination: url.pathname,
      routeKind: "external",
    }
  }

  const isWatchPath =
    url.pathname === WATCH_BASE_PATH ||
    url.pathname === `${WATCH_BASE_PATH}/` ||
    url.pathname.startsWith(`${WATCH_BASE_PATH}/`)
  if (!isWatchPath) {
    return {
      href,
      destination: url.pathname,
      routeKind: "site",
    }
  }

  const watchPathname =
    url.pathname === WATCH_BASE_PATH || url.pathname === `${WATCH_BASE_PATH}/`
      ? "/"
      : url.pathname.slice(WATCH_BASE_PATH.length)
  const parsed = parseWatchPath(watchPathname)

  if (
    parsed.kind === "localized-home" &&
    watchPathname === `/${parsed.lang}` &&
    isOneSegmentCollectionSlug(parsed.lang)
  ) {
    return {
      href,
      destination: url.pathname,
      routeKind: "one-segment-collection",
    }
  }

  return isCanonicalWatchPath(watchPathname, parsed)
    ? {
        href,
        destination: url.pathname,
        routeKind: parsed.kind,
      }
    : null
}

export function resolveWatchHomeSectionCtaHref(
  href: string | null | undefined,
): string | null {
  const classified = classifyWatchHomeCtaHref(href)
  return classified?.href ?? null
}

export function resolveWatchHomeMediaCtaHref({
  authoredHref,
  inferredHref,
  fallbackHref,
}: {
  authoredHref: string | null | undefined
  inferredHref: string | null | undefined
  fallbackHref: string
}): string {
  return (
    resolveWatchHomeSectionCtaHref(authoredHref) ?? inferredHref ?? fallbackHref
  )
}

export function watchHomeCtaAccessibleName(
  visibleLabel: string,
  contextCandidates: ReadonlyArray<string | null | undefined>,
): string {
  const label = visibleLabel.trim()
  const context = contextCandidates
    .map((candidate) => candidate?.trim() ?? "")
    .find((candidate) => candidate.length > 0 && candidate !== label)

  return context ? `${label}: ${context}` : label
}

export function watchHomeCtaAnalyticsContext({
  href,
  sectionKey,
}: {
  href: string
  sectionKey: string | null | undefined
}) {
  const classified = classifyWatchHomeCtaHref(href)
  const boundedSectionKey =
    sectionKey?.trim().slice(0, MAX_SECTION_KEY_LENGTH) || "unknown"

  return {
    surface: "watch_home",
    sectionKey: boundedSectionKey,
    destination: classified?.destination ?? "",
    routeKind: classified?.routeKind ?? "unknown",
  } as const
}
