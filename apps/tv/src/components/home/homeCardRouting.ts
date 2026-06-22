// Maps a Home card press to its destination route (R13). Pure module
// (mirrors searchResultPath.ts / episodeRouting.ts) so it is unit-testable
// under jest-expo without the component's React/JSX module graph.

import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { encodeWatchSeed } from "../../lib/watchSeed"

/** The card fields routing needs — WatchHomeCard satisfies this. */
export type RoutableHomeCard = Pick<
  WatchHomeCard,
  "slug" | "title" | "imageUrl" | "rawLabel" | "childCount"
>

/**
 * Series cards → /series/[slug], leaves → /watch/[slug] (predicate fed the RAW
 * `rawLabel`; display `label` is silently rejected). Carries a seed for instant
 * first paint; string href, not object (object double-encodes the seed). Null when no slug.
 */
export function resolveHomeCardPath(card: RoutableHomeCard): string | null {
  if (!card.slug) return null
  const seed = encodeWatchSeed({
    slug: card.slug,
    title: card.title,
    imageUrl: card.imageUrl,
    playbackId: null,
  })
  const base = isSeriesSearchResult({
    label: card.rawLabel,
    childCount: card.childCount,
  })
    ? "/series"
    : "/watch"
  return `${base}/${encodeURIComponent(card.slug)}?seed=${seed}`
}
