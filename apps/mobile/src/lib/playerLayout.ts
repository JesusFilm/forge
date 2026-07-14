// The 16:9 video player aspect ratio (height = width * this). Shared so the
// inline player, its loading skeleton, and the watch screen's scroll math stay
// in lockstep — three independent `9 / 16` literals drifted before this.
export const PLAYER_HEIGHT_RATIO = 9 / 16

// Inline player side inset; the floating back button sits just inside the
// player's top-left corner. Shared by the watch + series screens (todo 014).
export const PLAYER_SIDE_PADDING = 10

export const BACK_BUTTON_PROPS = {
  topOffset: 10,
  sideOffset: PLAYER_SIDE_PADDING + 8,
}
