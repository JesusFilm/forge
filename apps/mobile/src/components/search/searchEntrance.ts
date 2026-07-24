// Entrance timing for the search results grid — one owner, so the card and the
// "Load more" footer can never disagree about when a batch is on screen.

export const ENTRANCE_STAGGER_MS = 60
export const ENTRANCE_DURATION_MS = 280

/** A whole page must finish appearing inside a tap's attention span. */
export const ENTRANCE_MAX_STAGGER_STEPS = 8

/**
 * Delay for the card at `index`, staggered from the first index of its batch.
 * Keying to the ABSOLUTE index left page 2 invisible for ~2.6s after append, so
 * "Load more" finished onto a blank gap while rows held their layout space.
 */
export function entranceDelayMs(
  index: number,
  batchStartIndex: number,
): number {
  const step = Math.min(
    Math.max(0, Math.trunc(index) - Math.trunc(batchStartIndex)),
    ENTRANCE_MAX_STAGGER_STEPS,
  )
  return step * ENTRANCE_STAGGER_MS
}

/**
 * Ceiling on how long the footer may hold its loading state waiting for the
 * appended rows to lay out. Sits above a full batch's entrance so it only fires
 * when the list never reports back, never as a race against the real signal.
 */
export const REVEAL_FALLBACK_MS =
  ENTRANCE_MAX_STAGGER_STEPS * ENTRANCE_STAGGER_MS + ENTRANCE_DURATION_MS + 500
