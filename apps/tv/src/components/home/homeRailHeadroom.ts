// Pure focus-headroom geometry for the Home rails, extracted from HomeRail.tsx
// (JSX, untestable) so jest pins the parallax model and the resting-seam
// invariant: railPaddingTopFor(d) + railPullUpFor(d) === HEAD_CARD_GAP.

import { Platform } from "react-native"

import { scale } from "../../lib/scale"
import { FOCUS_RING_WIDTH, resolveFocusVisual } from "../focus/focusVisual"

const IS_ANDROID = Platform.OS === "android"

const THUMB_SPEC = resolveFocusVisual("thumb")

// Generous stand-in for the title+kind block under the art (~64 real) — only
// sizes focus headroom, so overestimating is safe.
const META_HEIGHT_ALLOWANCE = scale(80)

// Bottom item padding — keeps the rail-to-rail rhythm.
export const BASE_ITEM_PADDING = scale(24)

// Resting head→cards gap. The design's 22 ≈ 24 let the focused card's static
// rise (~21–27) crowd the title; 32 keeps a visible seam. Skeleton mirrors it.
export const HEAD_CARD_GAP = scale(32)

// tvOS touchpad nudges add RCTTVView's default parallax on top of the focus
// scale: ±2pt center shift + 0.05rad tilt about a 1/500 perspective, which
// magnifies the near top corner. Android TV has no parallax (D-pad only).
const PARALLAX_SHIFT_Y = IS_ANDROID ? 0 : 2
const PARALLAX_TILT_SIN = IS_ANDROID ? 0 : Math.sin(0.05)
const PARALLAX_TILT_COS = Math.cos(0.05)
const PARALLAX_PERSPECTIVE = 500

/** The card box a rail lays out — HOME_CARD_DIMS entries satisfy this. */
export type RailCardDims = {
  readonly width: number
  readonly thumbHeight: number
}

// Room the focused card needs above its layout box before the FlatList's
// scroll bounds clip it: half the magnify growth + lift + scaled ring, at the
// worst-case diagonal nudge (both tilts perspective-magnify the top corner).
export function focusHeadroomFor(dims: RailCardDims): number {
  const cardHeight = dims.thumbHeight + META_HEIGHT_ALLOWANCE
  const halfWidth = (dims.width / 2 + FOCUS_RING_WIDTH) * THUMB_SPEC.magnify
  const topFromCenter =
    (cardHeight / 2 + FOCUS_RING_WIDTH) * THUMB_SPEC.magnify + THUMB_SPEC.lift
  // UIKit applies the two tilts as separate additive CAAnimations that
  // compose by matrix concatenation, each with its own m34 — the offset
  // routed through both perspectives weighs (1+cos); bound both terms so.
  const perspectiveW =
    1 -
    (PARALLAX_TILT_SIN *
      (1 + PARALLAX_TILT_COS) *
      (halfWidth + topFromCenter)) /
      PARALLAX_PERSPECTIVE
  return Math.ceil(
    topFromCenter / perspectiveW + PARALLAX_SHIFT_Y - cardHeight / 2,
  )
}

/** Item paddingTop: the focus headroom, floored at the resting gap. */
export function railPaddingTopFor(dims: RailCardDims): number {
  return Math.max(HEAD_CARD_GAP, focusHeadroomFor(dims))
}

/** List marginTop carving the extra headroom out of the clip bounds, so the
 *  resting seam under the head stays exactly HEAD_CARD_GAP. */
export function railPullUpFor(dims: RailCardDims): number {
  return HEAD_CARD_GAP - railPaddingTopFor(dims)
}
