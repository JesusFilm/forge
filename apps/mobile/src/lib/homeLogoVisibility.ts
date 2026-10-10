/**
 * When Home's JFP logo leaves the screen and when it returns. Pure, with no
 * react-native imports, so it is unit-testable without the RN runtime.
 */

/** The logo leaves once the feed has scrolled this far down, in points. */
export const HOME_LOGO_HIDE_OFFSET = 10

/**
 * The logo returns only when the feed is back within this distance of its top.
 * Anything smaller than a point is the top; iOS can rest on a sub-pixel offset.
 */
export const HOME_LOGO_TOP_TOLERANCE = 1

/**
 * The next hidden state for a scroll offset. The two thresholds differ on
 * purpose: between them the logo keeps its current state, so a feed that
 * scrolls up without reaching the top does not bring the logo back.
 */
export function nextHomeLogoHidden(hidden: boolean, scrollY: number): boolean {
  return hidden
    ? scrollY >= HOME_LOGO_TOP_TOLERANCE
    : scrollY > HOME_LOGO_HIDE_OFFSET
}
