import { PUBLIC_WATCH_LANGUAGE_SLUGS } from "./public-watch-language-slugs"

export { PUBLIC_WATCH_LANGUAGE_SLUGS } from "./public-watch-language-slugs"

export const DEFAULT_WATCH_LANGUAGE_SLUG = "english"

export const PUBLIC_WATCH_ORIGIN = "https://www.jesusfilm.org"
export const DEFAULT_PUBLIC_WATCH_BASE_PATH = "/watch"
export const MAX_PUBLIC_WATCH_PATHNAME_LENGTH = 1000

const SAFE_PUBLIC_SLUG_PATTERN = /^[a-z0-9_-]+$/
const SAFE_BASE_PATH_PATTERN = /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/
const HTML_SUFFIX = ".html"

/**
 * First segments that belong to framework, asset, API, preview, or internal
 * subtrees rather than viewer-facing Watch pages. The monitor checks this
 * before it considers a URL for a live probe, so these values are deliberately
 * broader than the public route grammar.
 */
export const PUBLIC_WATCH_RESERVED_FIRST_SEGMENTS: ReadonlySet<string> =
  new Set([
    "api",
    "_next",
    "assets",
    "images",
    "fonts",
    "favicon.ico",
    "manifest.webmanifest",
    "preview",
    "sitemap",
    "robots.txt",
    "sitemap.xml",
    ".well-known",
    "demo-search",
    "demo-recommendations",
    "language-globe",
    "unavailable",
  ])

export type PublicWatchUtility =
  | "languages"
  | "videos"
  | "whats-new"
  | "history"
  | "search"

export type PublicWatchLocalizedUtility = "languages" | "videos" | "history"

export type PublicWatchPageShape =
  | {
      kind: "page"
      shape: "home"
      normalizedPathname: string
    }
  | {
      kind: "page"
      shape: "utility"
      utility: PublicWatchUtility
      normalizedPathname: string
    }
  | {
      kind: "page"
      shape: "localized-utility"
      languageSlug: string
      utility: PublicWatchLocalizedUtility
      normalizedPathname: string
    }
  | {
      kind: "page"
      shape: "one-segment"
      slug: string
      normalizedPathname: string
    }
  | {
      kind: "page"
      shape: "two-segment"
      firstSlug: string
      secondSlug: string
      normalizedPathname: string
    }
  | {
      kind: "page"
      shape: "episode"
      parentSlug: string
      episodeSlug: string
      languageSlug: string
      normalizedPathname: string
    }

export type PublicWatchPathnameClassification =
  | PublicWatchPageShape
  | { kind: "outside-watch" }
  | { kind: "reserved"; prefix: string }
  | {
      kind: "malformed"
      reason:
        | "invalid-base-path"
        | "unsafe-pathname"
        | "non-canonical-pathname"
        | "unsupported-shape"
    }

function stripRequiredHtmlSuffix(segment: string): string | null {
  if (!segment.endsWith(HTML_SUFFIX)) return null
  const slug = segment.slice(0, -HTML_SUFFIX.length)
  return SAFE_PUBLIC_SLUG_PATTERN.test(slug) ? slug : null
}

/**
 * Classify a complete, query-free public Watch pathname without importing
 * Next.js, locale catalogs, or application code.
 *
 * This is intentionally a syntax classifier, not an admission check. A page
 * shape is only a candidate until a caller compares its slugs with the current
 * Admin route manifest. Reserved and malformed results are safe to aggregate
 * by reason, but callers must not probe or persist their raw input.
 */
export function classifyPublicWatchPathname(
  pathname: string,
  basePath = DEFAULT_PUBLIC_WATCH_BASE_PATH,
): PublicWatchPathnameClassification {
  if (!SAFE_BASE_PATH_PATTERN.test(basePath) || basePath.endsWith("/")) {
    return { kind: "malformed", reason: "invalid-base-path" }
  }

  if (pathname === basePath || pathname === `${basePath}/`) {
    return {
      kind: "page",
      shape: "home",
      normalizedPathname: basePath,
    }
  }
  if (!pathname.startsWith(`${basePath}/`)) {
    return { kind: "outside-watch" }
  }
  if (
    pathname.length > MAX_PUBLIC_WATCH_PATHNAME_LENGTH ||
    !/^\/[A-Za-z0-9._\-/]+$/.test(pathname) ||
    pathname.includes("//") ||
    pathname.endsWith("/")
  ) {
    return { kind: "malformed", reason: "unsafe-pathname" }
  }

  const relativePathname = pathname.slice(basePath.length + 1)
  const segments = relativePathname.split("/")
  const first = segments[0]
  if (first && PUBLIC_WATCH_RESERVED_FIRST_SEGMENTS.has(first)) {
    return { kind: "reserved", prefix: first }
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { kind: "malformed", reason: "unsafe-pathname" }
  }

  if (segments.length === 1) {
    if (
      first === "languages" ||
      first === "videos" ||
      first === "whats-new" ||
      first === "history" ||
      first === "search"
    ) {
      return {
        kind: "page",
        shape: "utility",
        utility: first,
        normalizedPathname: pathname,
      }
    }

    const slug = stripRequiredHtmlSuffix(first ?? "")
    return slug == null
      ? { kind: "malformed", reason: "non-canonical-pathname" }
      : {
          kind: "page",
          shape: "one-segment",
          slug,
          normalizedPathname: pathname,
        }
  }

  if (segments.length === 2) {
    const firstSlug = stripRequiredHtmlSuffix(segments[0] ?? "")
    if (firstSlug == null) {
      return { kind: "malformed", reason: "non-canonical-pathname" }
    }

    const second = segments[1]
    if (second === "languages" || second === "videos" || second === "history") {
      return {
        kind: "page",
        shape: "localized-utility",
        languageSlug: firstSlug,
        utility: second,
        normalizedPathname: pathname,
      }
    }

    const secondSlug = stripRequiredHtmlSuffix(second ?? "")
    return secondSlug == null
      ? { kind: "malformed", reason: "non-canonical-pathname" }
      : {
          kind: "page",
          shape: "two-segment",
          firstSlug,
          secondSlug,
          normalizedPathname: pathname,
        }
  }

  if (segments.length === 3) {
    const parentSlug = stripRequiredHtmlSuffix(segments[0] ?? "")
    const episodeSlug = segments[1] ?? ""
    const languageSlug = stripRequiredHtmlSuffix(segments[2] ?? "")
    if (
      parentSlug != null &&
      SAFE_PUBLIC_SLUG_PATTERN.test(episodeSlug) &&
      languageSlug != null
    ) {
      return {
        kind: "page",
        shape: "episode",
        parentSlug,
        episodeSlug,
        languageSlug,
        normalizedPathname: pathname,
      }
    }
    return { kind: "malformed", reason: "non-canonical-pathname" }
  }

  return { kind: "malformed", reason: "unsupported-shape" }
}

/**
 * Whether a content slug may own `/{content}.html` as its canonical English
 * URL without colliding with an existing public language home.
 */
export function isLanguageLessWatchVideoPathEligible(
  contentSlug: string,
): boolean {
  return !PUBLIC_WATCH_LANGUAGE_SLUGS.has(contentSlug)
}

/** Build `/{content}.html/{language}.html` for compatibility and internals. */
export function buildExplicitWatchVideoPath(
  contentSlug: string,
  languageSlug: string,
): string {
  return `/${contentSlug}.html/${languageSlug}.html`
}

/**
 * Build the public standalone path. Eligible English omits its language;
 * international and collision-owned routes remain language-explicit.
 */
export function buildCanonicalWatchVideoPath(
  contentSlug: string,
  languageSlug: string,
): string {
  if (
    languageSlug === DEFAULT_WATCH_LANGUAGE_SLUG &&
    isLanguageLessWatchVideoPathEligible(contentSlug)
  ) {
    return `/${contentSlug}.html`
  }
  return buildExplicitWatchVideoPath(contentSlug, languageSlug)
}
