import { resolveImageUrl } from "../../lib/resolveImageUrl"

// SYNC: mirrors apps/mobile/src/lib/categoryThumbnail.ts (mobile reads
// `search`, TV aliases it `semanticSearch`). Pure (no Apollo), so the
// browse-category thumbnail pick is unit-testable.

type SearchResult = { imageUrl?: string | null } | null

/**
 * First search result with a usable thumbnail, resolved, or null. The top hit
 * sometimes has no artwork (e.g. "christmas" → "The Hope of Christmas"), so we
 * scan rather than take results[0] — the card would otherwise show its bare
 * gradient. Pair with a limit > 1 on the query so there's something to scan.
 */
export function pickThumbnailUrl(searchData: unknown): string | null {
  const results = (
    searchData as
      | { semanticSearch?: { results?: SearchResult[] } | null }
      | null
      | undefined
  )?.semanticSearch?.results
  if (!results) return null
  for (const result of results) {
    const url = resolveImageUrl(result?.imageUrl ?? null)
    if (url) return url
  }
  return null
}
