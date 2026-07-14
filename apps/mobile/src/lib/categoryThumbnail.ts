// SYNC: mirrors apps/tv/src/components/search/categoryThumbnail.ts (TV reads
// `semanticSearch`, mobile reads `search`).
import { resolveImageUrl } from "./resolveImageUrl"

/**
 * First search result WITH a usable thumbnail, resolved, or null. Pure (no
 * Apollo/network), so the browse-category thumbnail logic is unit-testable. The
 * top hit sometimes has no artwork (e.g. "christmas" → "The Hope of Christmas"),
 * so we scan rather than take results[0] — the card would otherwise show its
 * bare gradient. Pair with a limit > 1 on the query so there's something to scan.
 */
export function pickThumbnailUrl(searchData: unknown): string | null {
  const results = (
    searchData as
      | { search?: { results?: ({ imageUrl?: string | null } | null)[] } }
      | null
      | undefined
  )?.search?.results
  if (!results) return null
  for (const result of results) {
    const url = resolveImageUrl(result?.imageUrl ?? null)
    if (url) return url
  }
  return null
}
