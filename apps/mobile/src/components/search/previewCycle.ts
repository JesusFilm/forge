// Pure state for the search grid's auto-advancing Mux preview. React-free .ts
// so the ordering, the skip rule and the single-pass stop are unit-testable,
// mirroring ./searchEntrance and apps/tv's hoverPreviewDwell.

import { isSeriesSearchResult } from "../../lib/isSeriesRecord"

/** Grid settles before the first preview starts. */
export const PREVIEW_START_DELAY_MS = 1000

/**
 * One card's turn. Mux's animated.webp loops forever and expo-image reports no
 * end-of-loop, so the turn is a timer, not an event. 4s matches the clip the
 * URL requests (start=2 to end=6), so a card shows exactly one pass.
 */
export const PREVIEW_HOLD_MS = 4000

export type PreviewCandidate = {
  readonly label: string | null
  readonly childCount: number | null
  readonly playbackId: string | null
}

/**
 * A series never previews, EVEN when it carries a playback id — measured
 * 2026-09-07, 1 of 22 series rows had one, so gating on the id alone would
 * preview a series. Series-ness is `isSeriesSearchResult`, never childCount
 * alone: a feature film owns its chapter clips (JESUS has 61).
 */
export function isPreviewEligible(candidate: PreviewCandidate): boolean {
  if (isSeriesSearchResult(candidate)) return false
  return !!candidate.playbackId
}

/**
 * Ascending indices eligible to preview, restricted to what is on screen.
 * Ascending IS the reading order the grid renders: a two-column grid lays
 * results out left-to-right then down, so index order needs no 2D maths.
 */
export function buildPreviewQueue(
  results: readonly PreviewCandidate[],
  visibleIndices: readonly number[],
): number[] {
  return [...new Set(visibleIndices)]
    .filter(
      (i) => i >= 0 && i < results.length && isPreviewEligible(results[i]),
    )
    .sort((a, b) => a - b)
}

/**
 * The next card's index, or null when the pass is over. Compares by INDEX, not
 * by position, so a queue that changed under a scroll still advances forward
 * and can never replay a card the pass already showed.
 */
export function advancePreview(
  queue: readonly number[],
  current: number | null,
): number | null {
  if (current == null) return queue[0] ?? null
  return queue.find((i) => i > current) ?? null
}
