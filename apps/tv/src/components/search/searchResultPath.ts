// Maps a search result to its destination route. Kept as a pure module (not
// inside SearchResultsGrid.tsx) so it is unit-testable without loading the
// component's React/JSX module graph under jest-expo.

import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import { type SearchResult } from "../../lib/queries"
import { encodeWatchSeed } from "../../lib/watchSeed"

/**
 * Series-shaped videos open /series/[slug], leaf videos /watch/[slug], else
 * /experience. Seed gives first paint; series seed playbackId is nulled (never
 * derive a stream from it). encodeWatchSeed already URL-encodes (don't re-encode).
 */
export function searchResultPath(result: SearchResult): string {
  const slug = encodeURIComponent(result.slug)
  if (result.type === "VIDEO") {
    const isSeries = isSeriesSearchResult(result)
    const seed = encodeWatchSeed({
      slug: result.slug,
      title: result.title ?? null,
      imageUrl: result.imageUrl ?? null,
      playbackId: isSeries ? null : (result.playbackId ?? null),
    })
    const base = isSeries ? "series" : "watch"
    return `/${base}/${slug}?seed=${seed}`
  }
  return `/experience/${slug}`
}
