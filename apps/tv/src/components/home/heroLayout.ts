// Shared hero geometry so the pinned action row (HomeBillboard, in the
// ScrollView) and the sliding copy (HeroPager, a screen-level layer) line up
// from ONE source of truth. The copy lives in a different layer than the
// buttons, so its bottom padding must reserve the action row's height + gap to
// land directly above the buttons.

import { Dimensions } from "react-native"

import { scale } from "../../lib/scale"
import { TOP_BAR_HEIGHT } from "./HomeTopBar"

/** The hero region: 880px of the 1080px canvas — tall enough that the first
 *  carousel rail peeks below it at scroll 0. */
const HERO_DESIGN_RATIO = 880 / 1080

/**
 * The top bar sits in flow above the scroll feed, so the in-content hero
 * region is the 880/1080 design height minus the bar. The pager (a screen-level
 * layer) offsets its copy region down by TOP_BAR_HEIGHT to align with this.
 */
export const HERO_REGION_HEIGHT =
  Math.round(Dimensions.get("window").height * HERO_DESIGN_RATIO) -
  TOP_BAR_HEIGHT

export const HERO_PADDING_LEFT = scale(80)
export const HERO_PADDING_BOTTOM = scale(36)

/** Action row height (See more / chevron buttons are this tall) + its gap above
 *  the copy. The pager copy reserves both below itself so it sits exactly where
 *  it did when copy + buttons shared one flex column. */
export const HERO_ACTION_HEIGHT = scale(62)
export const HERO_ACTION_GAP = scale(26)

/** Copy bottom padding in the pager: clears the pinned action row beneath it. */
export const HERO_COPY_PADDING_BOTTOM =
  HERO_PADDING_BOTTOM + HERO_ACTION_HEIGHT + HERO_ACTION_GAP
