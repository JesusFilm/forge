/**
 * Ceiling on how far a watch page's body rides up over its muted hero preview.
 *
 * `HeroPlayer` measures the real episode rail and pulls the body up by the
 * smallest amount that keeps the rail inside the first viewport, capped by
 * these numbers. The Watch home intro solves the same problem — keep what is
 * below inside the first viewport — but by shrinking itself instead; see
 * `watch-home-hero-fit.ts`.
 */
export const HERO_PREVIEW_BODY_OVERLAP_MIN_PX = 160
export const HERO_PREVIEW_BODY_OVERLAP_MAX_PX = 288
export const HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX = 50
/** Percent of viewport height; `HeroPlayer` divides by 100 when measuring. */
export const HERO_PREVIEW_BODY_OVERLAP_VIEWPORT_PERCENT = 24

/**
 * The same ceiling as a CSS length, for the Watch home intro.
 *
 * A watch page's hero reaches this far under its body because the body carries
 * a negative top margin; the home intro cannot use that trick — its flow
 * bottom is what keeps the categories rail inside the viewport — so its media
 * layer reaches down past the frame by the same amount instead. Either way the
 * video runs on behind the panel covering it rather than stopping at its edge.
 *
 * The spaces around `+` are load-bearing: `calc()` rejects a bare `A+B`, and an
 * invalid length collapses what it sizes instead of erroring.
 */
export const WATCH_HERO_BODY_OVERLAP_CSS = `calc(min(${HERO_PREVIEW_BODY_OVERLAP_MAX_PX}px, max(${HERO_PREVIEW_BODY_OVERLAP_MIN_PX}px, ${HERO_PREVIEW_BODY_OVERLAP_VIEWPORT_PERCENT}svh)) + ${HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX}px)`
