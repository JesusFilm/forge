// Where a devotional video sits (the owner, 2026-10-14). The picture fills the
// height down to the bar and its sides are trimmed, so the bands above and
// below it stay small. The marker row sits over its top, the bar on its foot.
import { pauseSizes } from "./theme"

/** The devotional videos are 1080 x 1920. */
const VIDEO_ASPECT = 1080 / 1920

/** The top row: the close and the section markers, one 44 pt target high. */
export const RUN_TOP_ROW_HEIGHT = 44

/** The bar's touch strip reaches this far below the bar. The bar stops this far
 *  above the bottom safe area, so the strip never meets the home indicator,
 *  whose sideways swipe switches apps. */
export const RUN_BAR_CLEARANCE = 21

export type RunVideoLayout = {
  /** The picture's box: it can be wider than the screen, which trims it. */
  frame: { top: number; left: number; width: number; height: number }
  /** The bar's top edge. Its bottom edge is the picture's bottom edge. */
  barTop: number
  /** The marker row's top edge, over the picture: the safe area's edge, where
   *  the close sits on every step. */
  rowTop: number
}

export function runVideoLayout(
  width: number,
  height: number,
  insets: { top: number; bottom: number },
): RunVideoLayout {
  const frameHeight = Math.max(0, height - insets.bottom - RUN_BAR_CLEARANCE)
  const frameWidth = frameHeight * VIDEO_ASPECT
  return {
    frame: {
      top: 0,
      left: (width - frameWidth) / 2,
      width: frameWidth,
      height: frameHeight,
    },
    barTop: frameHeight - pauseSizes.progressBarHeight,
    rowTop: insets.top,
  }
}
