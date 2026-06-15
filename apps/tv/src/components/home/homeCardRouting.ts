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
 * Series-shaped cards open /series/[slug] directly; leaves open /watch/[slug].
 * Same predicate as search (isSeriesSearchResult: label or childCount), fed
 * the RAW wire enum `rawLabel` — never the display-text `label`, which the
 * strict-uppercase predicate would silently reject. Both targets carry a seed
 * for instant first paint with playbackId null: home cards are lean (no
 * stream fields — the 9.5MB rule), and a series seed must never yield a
 * stream. String href, like searchResultPath — object-form router.push would
 * percent-encode the already-encoded seed a second time. Returns null when
 * the card has no slug (unroutable; the press is a no-op).
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
