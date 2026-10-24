// Maps a Home card press to its destination route (R13). Pure module
// (mirrors searchResultPath.ts / episodeRouting.ts) so it is unit-testable
// under jest-expo without the component's React/JSX module graph.

import { isSeriesLabel } from "../../lib/isSeriesRecord"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { encodeWatchSeed } from "../../lib/watchSeed"

/** The card fields routing needs — WatchHomeCard satisfies this. */
export type RoutableHomeCard = Pick<
  WatchHomeCard,
  "slug" | "title" | "imageUrl" | "landscapeImageUrl" | "rawLabel"
>

/**
 * Series cards → /series, everything else → /watch. Fed the RAW `rawLabel`, and
 * `childCount` is NOT consulted — a film's chapter clips must not route it to
 * /series. String href, not object (an object double-encodes the seed).
 *
 * `autoplay` appends the flag the watch screen reads to jump straight into
 * playback (the Continue Watching shelf — a viewer resuming a video should not
 * have to press Play again). Ignored on the /series path, which has no player.
 */
export function resolveHomeCardPath(
  card: RoutableHomeCard,
  options?: { autoplay?: boolean },
): string | null {
  if (!card.slug) return null
  const seed = encodeWatchSeed({
    slug: card.slug,
    title: card.title,
    // The 16:9 cinematic, NOT card.imageUrl — a poster rail's card art is a 2:3
    // poster, and the seed paints the watch/series screen's landscape hero.
    imageUrl: card.landscapeImageUrl ?? card.imageUrl,
    playbackId: null,
  })
  const isSeries = isSeriesLabel(card.rawLabel)
  const base = isSeries ? "/series" : "/watch"
  const autoplay = options?.autoplay === true && !isSeries ? "&autoplay=1" : ""
  return `${base}/${encodeURIComponent(card.slug)}?seed=${seed}${autoplay}`
}
