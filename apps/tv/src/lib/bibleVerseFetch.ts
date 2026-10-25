// Cross-mount verse cache + dedupe for useBibleVerses, mirroring the module-scope
// thumbnailCache (search) and the ensureDubMedia ledger (dubMediaFetch). RN's
// fetch ignores `cache`, so a JS Map is the dedupe lever.

const BIBLE_API_BASE = "https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles"

// url -> formatted verse text. Only SUCCESSES are cached; a failed or aborted
// fetch is left out so the next mount retries (no negative caching).
const verseCache = new Map<string, string>()

export function buildVerseUrl(
  version: string,
  bookSlug: string,
  chapter: number,
  verse: number,
): string {
  return `${BIBLE_API_BASE}/${version}/books/${bookSlug}/chapters/${chapter}/verses/${verse}.json`
}

export function getCachedVerse(url: string): string | undefined {
  return verseCache.get(url)
}

export function cacheVerse(url: string, text: string): void {
  verseCache.set(url, text)
}

export type CitationUrl = { documentId: string; url: string | null }

// Split resolved citation URLs into text already in cache (keyed by documentId)
// and the deduplicated set still to fetch. A null url (unfetchable book/chapter)
// is dropped — the card falls back to reference-only.
export function partitionVerses(citations: readonly CitationUrl[]): {
  resolved: Record<string, string>
  toFetch: Set<string>
} {
  const resolved: Record<string, string> = {}
  const toFetch = new Set<string>()
  for (const { documentId, url } of citations) {
    if (url == null) continue
    const cached = verseCache.get(url)
    if (cached != null) resolved[documentId] = cached
    else toFetch.add(url)
  }
  return { resolved, toFetch }
}

// Test-only: reset module state between cases.
export function __resetVerseCache(): void {
  verseCache.clear()
}
