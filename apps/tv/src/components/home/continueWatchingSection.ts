// Client-owned "Continue Watching" Home section (feat-322) — built from the
// local anonymous resume shelf, not the admin Experience (same client-owned
// precedent as the hero queue). Pure builder so it is unit-testable without
// the Home screen's React graph.

import type { ContinueWatchingEntry } from "../../lib/watchEvents/continueWatching"
import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"

export const CONTINUE_WATCHING_SECTION_ID = "continue-watching"

/** Whole minutes of video left, floored at 1 so a nearly-finished video reads
 *  "1 min left" rather than "0 min left". Null when the duration is unknown. */
function minutesLeft(entry: ContinueWatchingEntry): number | null {
  if (entry.durationSeconds == null) return null
  return Math.max(
    1,
    Math.round((entry.durationSeconds - entry.positionSeconds) / 60),
  )
}

function toCard(entry: ContinueWatchingEntry): WatchHomeCard {
  const remaining = minutesLeft(entry)
  return {
    id: `cw-${entry.videoId}`,
    sourceId: entry.videoId,
    coreId: entry.videoId,
    slug: entry.slug,
    title: entry.title ?? entry.slug,
    description: null,
    // Empty: HomeCard omits the kind line entirely, since the rail header
    // above already reads "Continue Watching".
    label: "",
    // null routes the card to /watch (never /series — resume is per video).
    rawLabel: null,
    // Shown only while the card holds focus (metaLabelOnFocusOnly): the
    // resting shelf stays clean, and the viewer gets the exact time left on
    // whichever card they're considering.
    metaLabel: remaining != null ? `${remaining} min left` : null,
    metaLabelOnFocusOnly: true,
    imageUrl: entry.imageUrl,
    landscapeImageUrl: entry.imageUrl,
    imageAlt: entry.title ?? "Continue watching",
    // Null on purpose: the shelf card stays a STATIC thumbnail. A focused card
    // does not animate a hover preview the way curated rails do.
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
