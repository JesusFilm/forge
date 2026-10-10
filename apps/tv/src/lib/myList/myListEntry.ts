// Projection from a watch record onto a My List row. Pure and React-free so
// the rule that matters — which fields the saved card is rendered and ROUTED
// from — is unit-testable without the details screen's module graph.

import type { MyListEntry } from "./myList"

/** The record fields a saved row needs. `WatchVideoRecord` satisfies this, and
 *  so does the series screen's record — both carry the same four. */
export type SaveableRecord = {
  documentId: string
  slug: string
  title: string | null
  label: string | null
  posterUrl: string | null
}

/**
 * Build the row, or null when the record cannot be saved.
 *
 * `label` is copied VERBATIM into `rawLabel`: routing re-derives series-ness
 * from it through `isSeriesLabel`, which matches admin's uppercase wire
 * literals only. Normalizing or prettifying it here would send every saved
 * series to /watch, a screen with no player for it.
 */
export function toMyListEntry(
  record: SaveableRecord | null | undefined,
  addedAt: string,
): MyListEntry | null {
  if (record == null) return null
  // Both are load-bearing: documentId is the dedupe/account key, and a row
  // without a slug has nowhere to route.
  if (!record.documentId || !record.slug) return null
  return {
    videoId: record.documentId,
    slug: record.slug,
    title: record.title,
    imageUrl: record.posterUrl,
    rawLabel: record.label,
    addedAt,
  }
}
