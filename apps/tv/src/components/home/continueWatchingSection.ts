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
    // Empty: HomeCard omits the kind line entirely, since the rail header
    // above already reads "Continue Watching".
    label: "",
    // null routes the card to /watch (never /series — resume is per video).
    rawLabel: null,
    // No chip: the progress bar already conveys how far along the video is,
    // and a "N min left" badge over the same card is redundant noise.
    metaLabel: null,
    imageUrl: entry.imageUrl,
    landscapeImageUrl: entry.imageUrl,
    imageAlt: entry.title ?? "Continue watching",
    muxPlaybackId: entry.playbackId ?? null,
    durationSeconds: entry.durationSeconds,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    progressFraction:
      entry.progress != null && entry.progress > 0
        ? Math.min(1, entry.progress)
        : null,
    previewStartSeconds: resolvePreviewStart(entry),
  }
}

/** Preview window length Mux renders for a shelf card (matches the app default
 *  span so the animation feels identical to every other rail). */
const PREVIEW_WINDOW_SECONDS = 4

/**
 * Where the focused-card preview should start: the resume point, pulled back
 * far enough that the window fits before the end. Null (Mux default) when the
 * duration is unknown or too short to host a window at the resume point.
 */
function resolvePreviewStart(entry: ContinueWatchingEntry): number | null {
  const { positionSeconds, durationSeconds } = entry
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return null
  if (durationSeconds == null || durationSeconds <= PREVIEW_WINDOW_SECONDS) {
    return null
  }
  const latestStart = durationSeconds - PREVIEW_WINDOW_SECONDS
  return Math.max(0, Math.min(Math.floor(positionSeconds), latestStart))
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
