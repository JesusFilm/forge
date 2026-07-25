// SYNC: mirrors apps/tv/src/components/search/categoryThumbnail.ts.
import { resolveImageUrl } from "./resolveImageUrl"

/** Only the field this scan needs — callers pass mapped watchSearch results. */
type ThumbnailCandidate = { readonly imageUrl?: string | null }

/**
 * First result WITH a usable thumbnail, resolved, or null. Pure (no Apollo /
 * network), so the browse-category thumbnail logic is unit-testable. The top hit
 * sometimes has no artwork (e.g. "christmas" → "The Hope of Christmas"), so we
 * scan rather than take results[0] — the card would otherwise show its bare
 * gradient. Pair with a limit > 1 on the query so there's something to scan.
 */
export function pickThumbnailUrl(
  results:
    | readonly (ThumbnailCandidate | null | undefined)[]
    | null
    | undefined,
): string | null {
  if (!results) return null
  for (const result of results) {
    const url = resolveImageUrl(result?.imageUrl ?? null)
    if (url) return url
  }
  return null
}
