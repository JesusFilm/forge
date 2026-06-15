// Pure state for the redesigned Home screen's row-anchored scrolling and
// ambient chrome (deep scrim, top bar, hero actions). React-free .ts module
// (like showcaseState.ts) so it is unit-testable under jest-expo, which
// cannot load .tsx.
//
// The screen has three visual states driven by WHERE focus sits:
//   "top"    — focus on chrome (tab bar / hero actions): feed pinned to 0,
//              no deep scrim, top bar and hero actions fully visible.
//   "browse" — focus on a row-0 (featured) card: feed stays at 0, deep scrim
//              at 0.22, top bar visible, hero actions ghosted.
//   "deep"   — focus in rows >= 1: the row anchors near the viewport top,
//              deep scrim fully on, top bar hidden, hero actions ghosted.

export type HomeBrowseState = "top" | "browse" | "deep"

/**
 * Design-space distance (1920×1080 canvas) between the screen top and an
 * anchored row's top. Callers pass `scale(ROW_ANCHOR_OFFSET)` so the value
 * stays a pure number here.
 */
export const ROW_ANCHOR_OFFSET = 120

/**
 * Map a focused row index to the screen's visual state. `null` means focus
 * sits on chrome (tab bar / hero actions), not in any rail.
 */
export function resolveBrowseState(rowIndex: number | null): HomeBrowseState {
  if (rowIndex == null) return "top"
  return rowIndex <= 0 ? "browse" : "deep"
}

/**
 * Scroll target for a focused row. Row 0 pins the feed to 0 — the featured
 * rail's old scroll-to-top behavior folds in here. Rows >= 1 anchor the
 * shelf's measured layout y minus the anchor offset, clamped at 0. Returns
 * null when the row's layout has not been measured yet — the caller skips
 * the scroll rather than jumping somewhere wrong.
 */
export function resolveRowScrollTarget(args: {
  rowIndex: number
  /** Per-row content-relative layout y values captured via onLayout. */
  rowLayoutYs: ReadonlyArray<number | undefined>
  /** Already-scaled anchor distance from the viewport top. */
  anchorOffset: number
}): number | null {
  if (args.rowIndex <= 0) return 0
  const y = args.rowLayoutYs[args.rowIndex]
  if (y == null) return null
  return Math.max(0, y - args.anchorOffset)
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

/**
 * Hero actions ghost (opacity 0 but still mounted/focusable) while focus is
 * in ANY row, so D-pad up from row 0 lands on Play and fades them back in.
 */
export function areHeroActionsGhosted(state: HomeBrowseState): boolean {
  return state !== "top"
}
