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
 * Series cards → /series/[slug], everything else → /watch/[slug] (predicate fed
 * the RAW `rawLabel`; display `label` is silently rejected). `childCount` is NOT
 * consulted — a feature film's chapter clips must not route it to /series. Carries
 * a seed for instant first paint; string href, not object (object double-encodes
 * the seed). Null when no slug.
 */
export function resolveHomeCardPath(card: RoutableHomeCard): string | null {
  if (!card.slug) return null
  const seed = encodeWatchSeed({
    slug: card.slug,
    title: card.title,
    // The 16:9 cinematic, NOT card.imageUrl — a poster rail's card art is a 2:3
    // poster, and the seed paints the watch/series screen's landscape hero.
    imageUrl: card.landscapeImageUrl ?? card.imageUrl,
    playbackId: null,
  })
  const base = isSeriesLabel(card.rawLabel) ? "/series" : "/watch"
  return `${base}/${encodeURIComponent(card.slug)}?seed=${seed}`
}
