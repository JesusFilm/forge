// Pure, React-free helpers for the Bible-verse fetch (useBibleVerses). Split
// from the hook so they're unit-testable — jest-expo can't load React-importing
// modules (the @types/react csstype import trips the transform), same reason
// panelState.ts exists. SYNC: logic matches apps/mobile/src/hooks/useBibleVerses.ts
// and apps/web/src/components/watch/BibleQuotesSection.tsx.

const BOOK_SLUG_PATTERN = /^[a-z0-9-]+$/

/**
 * Sanitize a CMS-supplied book name into a jsdelivr-API-safe path segment.
 * Lowercasing alone keeps whitespace ("1 Corinthians" → "1 corinthians"),
 * which URL-encodes to a path the API repo doesn't contain. Strip whitespace
 * and reject anything that could escape the intended path.
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
