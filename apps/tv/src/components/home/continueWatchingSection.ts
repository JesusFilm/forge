// Client-owned "Continue Watching" Home section (feat-322) — built from the
// local anonymous resume shelf, not the admin Experience (same client-owned
// precedent as the hero queue). Pure builder so it is unit-testable without
// the Home screen's React graph.

import type { ContinueWatchingEntry } from "../../lib/watchEvents/continueWatching"
import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"

export const CONTINUE_WATCHING_SECTION_ID = "continue-watching"

function toCard(entry: ContinueWatchingEntry): WatchHomeCard {
  return {
    id: `cw-${entry.videoId}`,
    sourceId: entry.videoId,
    coreId: entry.videoId,
    slug: entry.slug,
    title: entry.title ?? entry.slug,
    description: null,
    label: "Continue Watching",
    // null routes the card to /watch (never /series — resume is per video).
    rawLabel: null,
    // No chip: the progress bar already conveys how far along the video is,
    // and a "N min left" badge over the same card is redundant noise.
    metaLabel: null,
    imageUrl: entry.imageUrl,
    landscapeImageUrl: entry.imageUrl,
    imageAlt: entry.title ?? "Continue watching",
    muxPlaybackId: null,
    durationSeconds: entry.durationSeconds,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    progressFraction:
      entry.progress != null && entry.progress > 0
        ? Math.min(1, entry.progress)
        : null,
  }
}

/** The synthetic section, or null when the shelf is empty (renders nothing). */
export function buildContinueWatchingSection(
  entries: readonly ContinueWatchingEntry[],
): WatchHomeSection | null {
  if (entries.length === 0) return null
  return {
    id: CONTINUE_WATCHING_SECTION_ID,
    eyebrow: "Jump back in",
    title: "Continue Watching",
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    isPosterRail: false,
    cards: entries.map(toCard),
  }
}
