/**
 * How much of a pinned hero the page body has slid over.
 *
 * Both watch heroes are sticky: the body scrolls UP over them rather than the
 * hero scrolling away. `IntersectionObserver` is useless here — a sticky
 * element keeps reporting "in viewport" while painted over — so coverage is
 * measured from the body's own top edge instead.
 */
export const WATCH_HERO_OBSCURED_PAUSE_THRESHOLD = 0.6

export type WatchHeroCoverInput = {
  /** Rendered hero height in px. */
  heroHeight: number
  /** Viewport height in px. */
  viewportHeight: number
  /**
   * Distance from the hero's visible top down to the body's top edge. Negative
   * once the body has scrolled past the hero's top.
   */
  bodyTopFromHeroTop: number
}

/** 0 = fully visible, 1 = fully covered. */
export function watchHeroObscuredFraction({
  heroHeight,
  viewportHeight,
  bodyTopFromHeroTop,
}: WatchHeroCoverInput): number {
  // When the hero is taller than the viewport the sticky pin keeps it filling
  // the viewport, so the visible part is the viewport; otherwise it is the
  // hero's own height.
  const visibleVideoHeight = Math.min(heroHeight, viewportHeight)
  const unobscuredHeight = Math.max(
    0,
    Math.min(visibleVideoHeight, bodyTopFromHeroTop),
  )
  if (visibleVideoHeight <= 0) return 1
  return 1 - unobscuredHeight / visibleVideoHeight
}

export function isWatchHeroObscured(input: WatchHeroCoverInput): boolean {
  return watchHeroObscuredFraction(input) >= WATCH_HERO_OBSCURED_PAUSE_THRESHOLD
}
