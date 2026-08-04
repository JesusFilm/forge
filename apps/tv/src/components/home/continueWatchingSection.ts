// Client-owned "Continue Watching" Home section (feat-322) — built from the
// local anonymous resume shelf, not the admin Experience (same client-owned
// precedent as the hero queue). Pure builder so it is unit-testable without
// the Home screen's React graph.

import type { ContinueWatchingEntry } from "../../lib/watchEvents/continueWatching"
import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"

export const CONTINUE_WATCHING_SECTION_ID = "continue-watching"

function toCard(entry: ContinueWatchingEntry): WatchHomeCard {
  const minutesLeft =
    entry.durationSeconds != null
      ? Math.max(
          1,
          Math.round((entry.durationSeconds - entry.positionSeconds) / 60),
        )
      : null
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
    metaLabel: minutesLeft != null ? `${minutesLeft} min left` : null,
    imageUrl: entry.imageUrl,
    landscapeImageUrl: entry.imageUrl,
    imageAlt: entry.title ?? "Continue watching",
    muxPlaybackId: null,
    durationSeconds: entry.durationSeconds,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
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
