// Pure, React-free helpers for the Bible-verse fetch (useBibleVerses), split out
// so they're unit-testable — jest-expo can't load React-importing modules (same
// reason panelState.ts exists). SYNC: apps/mobile useBibleVerses + web BibleQuotesSection.

const BOOK_SLUG_PATTERN = /^[a-z0-9-]+$/

/**
 * Sanitize a CMS book name into a jsdelivr-API-safe path segment. Lowercasing
 * alone keeps whitespace ("1 Corinthians"), which URL-encodes to a path the API
 * repo lacks; strip whitespace and reject anything that could escape the path.
 */
export function bookSlugForApi(rawBookName: string): string | null {
  const slug = rawBookName.toLowerCase().replace(/\s+/g, "")
  return BOOK_SLUG_PATTERN.test(slug) ? slug : null
}

/** Strip the API's inline footnotes (";N…" / ",N:N…") and collapse newlines. */
export function formatScripture(verse: string): string {
  return verse
    .replace(/;\d[\s\S]*/, "")
    .replace(/,\d:\d[\s\S]*/, "")
    .replace(/\n/g, " ")
    .trim()
}

/** The API returns `{ verse, text }` for valid verses; guard the shape. */
export function isFetchedScripture(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as { text: unknown }).text === "string" &&
    (value as { text: string }).text.length > 0
  )
}
