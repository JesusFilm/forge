/**
 * Sizing rule for the Watch home muted intro: it must stay short enough that
 * the categories rail under it is fully visible in the first viewport.
 *
 * The rail's height is not knowable in CSS and is not constant — measured at
 * 488px on a 390px-wide phone (copy wraps more), 413-425px across desktop
 * widths, and it moves again with locale — so the live height is measured and
 * fed in. The reserves below are only the pre-hydration estimate baked into
 * the CSS, and the fallback when no rail is on the page.
 */
export const WATCH_HOME_HERO_RESERVE_BELOW_PX = 440
export const WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX = 500

/**
 * Pre-hydration/fallback height for decorative muted Watch intros.
 *
 * The home carousel refines this after measuring its category rail. Static
 * series heroes have no playback transition or measurable horizontal rail,
 * so they keep this same bounded intro height. Keeping the complete Tailwind
 * expression here prevents those two muted surfaces from drifting apart.
 */
export const WATCH_MUTED_INTRO_HEIGHT_CLASS =
  "h-[max(34svh,calc(100svh_-_500px))] md:h-[max(34svh,min(56.25vw,calc(100svh_-_440px)))]"

/**
 * Floor, as a share of the viewport. Without it a short window (or a rail that
 * grows past the space available) would shrink the intro to nothing; below
 * this the rail simply does not fit, which is the better failure.
 */
export const WATCH_HOME_HERO_MIN_HEIGHT_RATIO = 0.34

/**
 * The intro's unconstrained height, as ratios. These MUST match the `56.25vw`
 * and `66svh` literals in the hero's Tailwind classes — Tailwind cannot
 * interpolate, so `watch-home-hero-fit.test.ts` pins them against those strings.
 */
export const WATCH_HOME_HERO_ASPECT_RATIO = 0.5625
export const WATCH_HOME_HERO_MOBILE_VIEWPORT_RATIO = 0.66

export type WatchHomeHeroFitInput = {
  /** Viewport height in px. */
  viewportHeight: number
  /** The intro's unconstrained height — its 16:9 (or mobile) height. */
  aspectHeight: number
  /** Measured height of the content that must fit under it. */
  reservedBelow: number
}

export function fitWatchHomeHeroHeight({
  viewportHeight,
  aspectHeight,
  reservedBelow,
}: WatchHomeHeroFitInput): number {
  const spaceLeft = viewportHeight - reservedBelow
  // The floor can never push the intro past its own aspect height — fitting is
  // only ever allowed to shrink it.
  const floor = Math.min(
    aspectHeight,
    viewportHeight * WATCH_HOME_HERO_MIN_HEIGHT_RATIO,
  )
  // Floor, never round: the measured rail height is fractional, and rounding
  // up hands the rail's last pixel back to the intro — enough to push the rail
  // one pixel past the fold.
  return Math.floor(Math.max(floor, Math.min(aspectHeight, spaceLeft)))
}
