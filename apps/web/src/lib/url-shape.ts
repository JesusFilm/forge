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
export const RESERVED_PREFIXES: ReadonlySet<string> = new Set([
  "api",
  "_next",
  "assets",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  ".well-known",
])
