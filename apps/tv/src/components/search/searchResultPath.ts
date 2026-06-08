// Maps a search result to its destination route. Kept as a pure module (not
// inside SearchResultsGrid.tsx) so it is unit-testable without loading the
// component's React/JSX module graph under jest-expo.

import { type SearchResult } from "../../lib/queries"
import { encodeWatchSeed } from "../../lib/watchSeed"

/**
 * Video results open the new /watch/[slug] details page with a seed for instant
 * first paint; everything else (experiences) keeps the existing /experience
 * route. `encodeWatchSeed` already URL-encodes its return value, so the seed is
 * appended without further encoding.
 */
export function searchResultPath(result: SearchResult): string {
  const slug = encodeURIComponent(result.slug)
  if (result.type === "VIDEO") {
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
