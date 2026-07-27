// Maps a search result to its destination route. Kept as a pure module (not
// inside SearchResultsGrid.tsx) so it is unit-testable without loading the
// component's React/JSX module graph under jest-expo.

import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { type SearchResult } from "../../lib/queries"
import { encodeWatchSeed } from "../../lib/watchSeed"

/**
 * Series-LABELLED videos open /series, everything else /watch, else /experience.
 * `childCount` is NOT consulted — a film's chapter clips must not route it to
 * /series. A series seed nulls playbackId: never derive a stream from it.
 */
export function searchResultPath(result: SearchResult): string {
  const slug = encodeURIComponent(result.slug)
  if (result.type === "VIDEO") {
    const isSeries = isSeriesLabel(result.label)
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
