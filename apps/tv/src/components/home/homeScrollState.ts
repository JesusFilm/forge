// Pure state for Home's row-anchored scrolling + chrome. React-free .ts so jest-expo can test it.
// Three focus-driven states: "top" (tabs, feed at 0, no scrim), "browse" (row 0 anchored up,
// scrim 0.22), "deep" (rows >= 1 anchored up, full scrim, top bar hidden).

export type HomeBrowseState = "top" | "browse" | "deep"

/**
 * Design-space distance (1920×1080) from screen top to an anchored row's top.
 * Callers pass `scale(ROW_ANCHOR_OFFSET)` so this stays a pure number.
 */
export const ROW_ANCHOR_OFFSET = 120

/**
 * Map a focused row index to the screen's visual state. `null` means focus
 * sits on the top bar tabs, not in any rail.
 */
export function resolveBrowseState(rowIndex: number | null): HomeBrowseState {
  if (rowIndex == null) return "top"
  return rowIndex <= 0 ? "browse" : "deep"
}

/**
 * Scroll target for a focused row: every row (incl. row 0, which peeks under the
 * tall hero) anchors at layout y minus offset, clamped at 0. Returns null when
 * the row isn't measured yet so the caller skips rather than jumps wrong.
 */
export function resolveRowScrollTarget(args: {
  rowIndex: number
  /** Per-row content-relative layout y values captured via onLayout. */
  rowLayoutYs: ReadonlyArray<number | undefined>
  /** Already-scaled anchor distance from the viewport top. */
  anchorOffset: number
}): number | null {
  const y = args.rowLayoutYs[args.rowIndex]
  if (y == null) return null
  return Math.max(0, y - args.anchorOffset)
}

/**
 * Trim, don't wipe: onLayout only re-fires for rows that actually moved, so
 * clearing the store strands unchanged rows unmeasured and focus stops scrolling.
 * Mutates in place — the caller holds it in a ref.
 */
export function trimRowMeasurements(
  rowLayoutYs: (number | undefined)[],
  rowCount: number,
): void {
  rowLayoutYs.length = Math.max(0, rowCount)
}

/** What a fresh onLayout measurement should trigger. */
export type RowMeasurementEffect = "flush-pending" | "reanchor" | "none"

/**
 * "flush-pending": focused before it had any measurement, run the deferred scroll.
 * "reanchor": holds focus and its y MOVED, so the offset came from a stale value.
 * Otherwise nothing — re-scrolling an unfocused row yanks the page off the viewer.
 */
export function resolveRowMeasurementEffect(args: {
  rowIndex: number
  previousY: number | undefined
  nextY: number
  pendingScrollRow: number | null
  focusedRow: number | null
}): RowMeasurementEffect {
  if (args.pendingScrollRow === args.rowIndex) return "flush-pending"
  if (args.focusedRow === args.rowIndex && args.previousY !== args.nextY) {
    return "reanchor"
  }
  return "none"
}

/**
 * Opacity of the deep-scrim layer (its background is rgba(6,6,8,.9)):
 * invisible on chrome, a light wash while browsing row 0, fully on when
 * focus is deep in the feed.
 */
export function deepScrimOpacity(state: HomeBrowseState): number {
  switch (state) {
    case "top":
      return 0
    case "browse":
      return 0.22
    case "deep":
      return 1
  }
}

/** The top bar hides only when focus is deep in the feed (rows >= 1). */
export function isTopBarHidden(state: HomeBrowseState): boolean {
  return state === "deep"
}
