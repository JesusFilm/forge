// Maps a search result to its destination route. Kept as a pure module (not
// inside SearchResultsGrid.tsx) so it is unit-testable without loading the
// component's React/JSX module graph under jest-expo.

import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import { type SearchResult } from "../../lib/queries"
import { encodeWatchSeed } from "../../lib/watchSeed"

/**
 * Series-shaped video results (label or childCount) open /series/[slug]
 * directly — no /watch hop-and-redirect. Leaf video results open the
 * /watch/[slug] details page. Both carry a seed for instant first paint; the
 * series seed's playbackId is nulled (the series screen mounts no video, and
 * a stream must never be derived from its seed). Everything else
 * (experiences) keeps the existing /experience route. `encodeWatchSeed`
 * already URL-encodes its return value, so the seed is appended without
 * further encoding.
 */
export function searchResultPath(result: SearchResult): string {
  const slug = encodeURIComponent(result.slug)
  if (result.type === "VIDEO") {
    if (isSeriesSearchResult(result)) {
      const seed = encodeWatchSeed({
        slug: result.slug,
        title: result.title ?? null,
        imageUrl: result.imageUrl ?? null,
        playbackId: null,
      })
      return `/series/${slug}?seed=${seed}`
    }
    const seed = encodeWatchSeed({
      slug: result.slug,
      title: result.title ?? null,
      imageUrl: result.imageUrl ?? null,
      playbackId: result.playbackId ?? null,
    })
    return `/watch/${slug}?seed=${seed}`
  }
  return `/experience/${slug}`
}
