/**
 * Geometry shared by `SearchResultCard` and `SearchResultSkeleton` so the
 * loading state and the loaded card occupy the same box and nothing jumps.
 */

/**
 * The art is 32:15 (`mobileCinematicHigh`, Cloudflare w=1280,h=600 — measured
 * 45/45 results on 2026-09-07), so 16:9 crops 8.3% off each side. That is a
 * deliberate trade: the familiar video shape over an uncropped one.
 */
export const SEARCH_THUMB_ASPECT = 16 / 9

/** Thumbnail corner radius. Shared so the card and its skeleton match. */
export const SEARCH_CARD_RADIUS = 10

/**
 * Fixed so every card in a grid row is the same height: a one-line title next
 * to a two-line one would otherwise leave a ragged row. Sized for the title at
 * its LARGEST: SEARCH_CARD_TITLE_MAX_SCALE lifts lineHeight 20 to 23, so
 * 8 top + 2x23 = 54, plus 4 of breathing room. Grow both together.
 */
export const SEARCH_CARD_TEXT_HEIGHT = 58

/**
 * Caps OS text scaling on the card title. The grid needs equal-height rows, and
 * 1.15 is the same ceiling useTypography clamps its own scale to.
 */
export const SEARCH_CARD_TITLE_MAX_SCALE = 1.15

/**
 * Half-gaps: each card carries them on both sides, so the gap BETWEEN two
 * cards is twice these. Split so the row gap can grow without widening the
 * column gap, which `margin` alone could not do.
 */
export const SEARCH_CARD_GAP_X = 6
export const SEARCH_CARD_GAP_Y = 9
