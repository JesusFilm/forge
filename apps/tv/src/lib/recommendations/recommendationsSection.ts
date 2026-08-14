// "Because you watched <title>" — the client-owned personalized Home rail.
// Pure: seed choice, row projection and the hide-when-empty rule all live here
// so they are unit-testable without the Home screen's React graph (apps/tv has
// no render harness).

import { getMuxThumbnailUrlFromPlaybackId } from "../resolveImageUrl"
import type { ContinueWatchingEntry } from "../watchEvents/continueWatching"
import type { WatchHomeCard, WatchHomeSection } from "../watchHome/model"

export const RECOMMENDATIONS_SECTION_ID = "because-you-watched"
/** One rail's worth. Admin clamps to 50; asking for more than fits is waste. */
export const RECOMMENDATIONS_LIMIT = 12

/** One recommendation row, as selected by GET_BECAUSE_YOU_WATCHED. */
export type RecommendationRow = {
  videoId: string
  videoSlug: string
  videoTitle: string
  playbackId: string
}

export type RecommendationSeed = {
  videoId: string
  title: string
}

/**
 * Which video the rail recommends against.
 *
 * The freshest Continue Watching entry — the most recent thing this viewer
 * actually engaged with, and the only watch history the client holds locally.
 * Finished videos leave the shelf by design, so the seed tracks what is
 * currently in progress; that is the honest interpretation of "because you
 * watched" without a server-side history read.
 *
 * Entries arrive newest-first from storage, so this is the head — but it is
 * chosen explicitly rather than by trusting the caller's ordering.
 */
export function pickRecommendationSeed(
  entries: readonly ContinueWatchingEntry[],
): RecommendationSeed | null {
  let newest: ContinueWatchingEntry | null = null
  for (const entry of entries) {
    if (!entry.videoId) continue
    if (newest == null || isNewerStamp(entry.updatedAt, newest.updatedAt)) {
      newest = entry
    }
  }
  if (newest == null) return null
  return { videoId: newest.videoId, title: newest.title ?? newest.slug }
}

/**
 * Stamp comparison by PARSED time, with a lexicographic fallback.
 *
 * Locally written stamps are always `new Date().toISOString()` — fixed-width
 * UTC, where string order equals time order. But the shelf is also hydrated
 * from the ACCOUNT, whose stamps come from the server: any other valid ISO
 * spelling (an `+00:00` offset, or seconds without milliseconds) breaks the
 * string comparison while parsing fine. Parsing first makes the mixed-source
 * shelf safe; the fallback keeps a malformed stamp from throwing the ordering
 * away entirely.
 */
function isNewerStamp(candidate: string, incumbent: string): boolean {
  const a = Date.parse(candidate)
  const b = Date.parse(incumbent)
  if (Number.isNaN(a) || Number.isNaN(b)) return candidate > incumbent
  return a > b
}

function toCard(row: RecommendationRow): WatchHomeCard {
  const image = getMuxThumbnailUrlFromPlaybackId(row.playbackId)
  return {
    id: `rec-${row.videoId}`,
    sourceId: row.videoId,
    coreId: row.videoId,
    slug: row.videoSlug,
    title: row.videoTitle,
    description: null,
    // The rail header already says why these are here; a per-card kind noun
    // would just repeat the rails above.
    label: "",
    // Recommendations are always single videos — admin excludes the seed's own
    // parent and children — so null routes every card to /watch.
    rawLabel: null,
    metaLabel: null,
    imageUrl: image,
    landscapeImageUrl: image,
    imageAlt: row.videoTitle,
    // Static thumbnail, like the other client-owned rails.
    muxPlaybackId: null,
    durationSeconds: null,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
  }
}

/**
 * The synthetic section, or null when there is nothing worth showing.
 *
 * Null covers all three degraded cases, and every one is reachable in
 * production: no seed (nothing watched yet), no rows (admin soft-swallows an
 * un-embedded seed to `[]`), and rows that survive neither filter. A rail with
 * a header and no cards is the bug; a missing rail is the designed outcome.
 */
export function buildRecommendationsSection(
  seed: RecommendationSeed | null,
  rows: readonly RecommendationRow[],
): WatchHomeSection | null {
  if (seed == null) return null
  const usable = rows.filter(
    (row) =>
      row.videoId.length > 0 &&
      row.videoSlug.length > 0 &&
      // Never recommend the seed back to the viewer. Admin excludes it
      // server-side; this is the client half of that contract, and it is what
      // keeps the rail honest if a future seeding change (e.g. by slug) loses
      // the exclusion.
      row.videoId !== seed.videoId,
  )
  if (usable.length === 0) return null
  return {
    id: RECOMMENDATIONS_SECTION_ID,
    eyebrow: "Because you watched",
    title: seed.title,
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    isPosterRail: false,
    cards: usable.slice(0, RECOMMENDATIONS_LIMIT).map(toCard),
  }
}
