// Client-owned "My List" Home section — built from the local watchlist bucket,
// not the admin Experience (same client-owned precedent as the hero queue and
// the Continue Watching shelf beside it). Pure builder so it is unit-testable
// without the Home screen's React graph.

import type { MyListEntry } from "../../lib/myList/myList"
import { labelText } from "../../lib/watchHome/model"
import type { WatchHomeCard, WatchHomeSection } from "../../lib/watchHome/model"

export const MY_LIST_SECTION_ID = "my-list"

function toCard(entry: MyListEntry): WatchHomeCard {
  return {
    id: `ml-${entry.videoId}`,
    sourceId: entry.videoId,
    coreId: entry.videoId,
    slug: entry.slug,
    title: entry.title ?? entry.slug,
    description: null,
    // Unlike the Continue Watching shelf (whose rows are always single videos),
    // a saved list mixes films, episodes and series — so the kind noun earns
    // its line here.
    label: labelText(entry.rawLabel),
    // The RAW wire label, passed through untouched: resolveHomeCardPath sends
    // SERIES/COLLECTION to /series and everything else to /watch, and it
    // matches uppercase wire literals only.
    rawLabel: entry.rawLabel,
    metaLabel: null,
    imageUrl: entry.imageUrl,
    landscapeImageUrl: entry.imageUrl,
    imageAlt: entry.title ?? "Saved to My List",
    // Static thumbnail, like the resume shelf: a saved-items rail does not
    // animate hover previews.
    muxPlaybackId: null,
    durationSeconds: null,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
  }
}

/**
 * The synthetic section, or null when nothing is saved.
 *
 * Null is load-bearing: an empty rail (a header with no cards) is a bug, and
 * Home must simply not show My List until the viewer has saved something.
 * Entries arrive newest-first from storage and that order is preserved.
 */
export function buildMyListSection(
  entries: readonly MyListEntry[],
): WatchHomeSection | null {
  if (entries.length === 0) return null
  return {
    id: MY_LIST_SECTION_ID,
    eyebrow: "Saved by you",
    title: "My List",
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    isPosterRail: false,
    cards: entries.map(toCard),
  }
}
