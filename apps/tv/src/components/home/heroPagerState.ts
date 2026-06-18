// Pure, React-free helpers for the hero pager's slide ring (HeroPager). Kept
// here — like homeScrollState.ts / showcaseState.ts — so the index math and the
// "already showing it" skip guard are jest-testable without rendering.

/**
 * Step the slide index by `delta` (+1 next, -1 previous), wrapping both ends
 * (last → first on +1, first → last on -1). Returns 0 for an empty set. The
 * `+ count` before the modulo keeps a negative `current + delta` positive.
 */
export function advanceByDelta(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return 0
  return (((current + delta) % count) + count) % count
}

/** The two-cell ring's other face. */
export function backFace(front: 0 | 1): 0 | 1 {
  return front === 0 ? 1 : 0
}

/**
 * Whether a requested slide is already the one on the front face — in which
 * case there is nothing to slide (mirrors HomeBackdrop aborting a crossfade to
 * the artwork it already shows). Null ids never match (nothing painted yet).
 */
export function shouldSkipSlide(
  incomingId: string | null | undefined,
  frontId: string | null | undefined,
): boolean {
  return incomingId != null && incomingId === frontId
}
