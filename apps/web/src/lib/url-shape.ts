/** Literal `.html` suffix used throughout the watch URL space. Lowercase by construction. */
export const HTML_SUFFIX = ".html"

/** Anchored case-insensitive regex matching `.html` at end of a segment. */
export const HTML_SUFFIX_REGEX = /\.html$/i

/** Remove a trailing `.html` (case-insensitive) from a single segment. */
export function stripHtmlSuffix(segment: string): string {
  return segment.replace(HTML_SUFFIX_REGEX, "")
}

/** True iff the segment ends in `.html` (case-insensitive). */
export function hasHtmlSuffix(segment: string): boolean {
  return HTML_SUFFIX_REGEX.test(segment)
}

/** Append `.html` to a segment unless already suffixed. Idempotent. */
export function appendHtmlSuffix(segment: string): string {
  return hasHtmlSuffix(segment) ? segment : `${segment}${HTML_SUFFIX}`
}

// Reserved first-segment prefixes that bypass watch URL canonicalization
// and parsing. Single source of truth — both proxy/canonicalize and the
// route parser read this set so the two halves cannot drift.
//
// Pairs with the matcher regex in apps/web/src/proxy.ts. Narrowing this
// set reopens any gaps in the matcher (e.g. if the matcher only excludes
// `_next/static|_next/image|_next/data|_next/webpack-hmr` but
// canonicalize stops protecting bare `_next`, future Next subtrees slip
// through). Keep this set BROADER than the matcher.
export const RESERVED_PREFIXES: ReadonlySet<string> = new Set([
  "api",
  "_next",
  "assets",
  "images",
  "fonts",
  "favicon.ico",
  "preview",
  "sitemap",
  "robots.txt",
  "sitemap.xml",
  ".well-known",
])

/**
 * Index of the locale segment for a canonical /watch URL split into
 * segments. Returns `1` for the 2-segment shape `/{slug}/{locale}`,
 * `2` for the 3-segment episode shape `/{series}/{episode}/{locale}`,
 * and `-1` for any other length.
 *
 * Single source of truth for the "locale is the last segment" invariant
 * shared by proxy.ts (isWatchRoute + cookie redirect) and
 * url-canonicalize.ts (Rule 6 alias resolution).
 */
export function getWatchLocaleSegmentIndex(
  segments: readonly string[],
): 1 | 2 | -1 {
  if (segments.length === 2) return 1
  if (segments.length === 3) return 2
  return -1
}

// Origin-invariance + header-injection guard. Matches any path that could
// escape origin (leading `//`, backslash) or carry CRLF / percent-encoded
// CRLF for header injection. Single source of truth: both
// url-canonicalize.ts (input + output revalidation) and proxy.ts (cookie
// redirect output revalidation) test every synthesized Location against it.
export const UNSAFE_PATH_PATTERN = /(^\/\/)|[\\\r\n]|(%0[ad])/i

/**
 * True if a synthesized redirect path could escape origin or inject
 * headers. Combines the `UNSAFE_PATH_PATTERN` scan with the absolute-path
 * + no-protocol-relative invariants. Every redirect Location built from
 * partly-untrusted input MUST pass `!isUnsafeRedirectPath(path)` before
 * being emitted.
 */
export function isUnsafeRedirectPath(path: string): boolean {
  return (
    UNSAFE_PATH_PATTERN.test(path) ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
}

// Content-safe ASCII slug: lowercase alphanumerics, hyphen, and underscore.
// Admin content slugs include legacy underscores such as
// `soccer_event_collection`; public language slugs are still narrowed by
// locale-specific validators after this shape check.
export const SAFE_SLUG_PATTERN = /^[a-z0-9_-]+$/

// One-segment collection landings observed in production. Most collections
// and all single-video slugs 404 without an explicit language segment, so keep
// this surface small instead of letting arbitrary slugs mint cache entries.
export const ONE_SEGMENT_COLLECTION_SLUGS: ReadonlySet<string> = new Set([
  "easter",
])

export function isOneSegmentCollectionSlug(slug: string): boolean {
  return ONE_SEGMENT_COLLECTION_SLUGS.has(slug)
}
