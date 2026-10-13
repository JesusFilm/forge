import { isLayoutRtl, layoutSign } from "../i18n/layoutRtl"

/** The part of a scroll event that horizontal paging reads. */
type ScrollMetrics = {
  contentOffset: { x: number }
  contentSize: { width: number }
  layoutMeasurement: { width: number }
}

/**
 * The hero a released swipe moves to, or null when the drag is too short.
 * A drag against the reading direction moves to the next hero (feat-695 R11):
 * to the left in a left-to-right layout, to the right in a right-to-left one.
 */
export function heroSwipeTarget({
  dx,
  index,
  slideCount,
  commitPx,
}: {
  dx: number
  index: number
  slideCount: number
  commitPx: number
}): number | null {
  const readingDx = dx * layoutSign()
  if (readingDx < -commitPx) return Math.min(index + 1, slideCount - 1)
  if (readingDx > commitPx) return Math.max(index - 1, 0)
  return null
}

/**
 * The page a horizontal list rests on, counted from its start edge.
 * Both platforms report `contentOffset.x` from the left edge of the content
 * in either direction, so a right-to-left layout counts from the other end.
 */
export function scrollPageIndex(
  metrics: ScrollMetrics,
  pageLength: number,
): number {
  const fromLeft = metrics.contentOffset.x
  const fromStart = isLayoutRtl()
    ? metrics.contentSize.width - metrics.layoutMeasurement.width - fromLeft
    : fromLeft
  return Math.round(fromStart / pageLength)
}
