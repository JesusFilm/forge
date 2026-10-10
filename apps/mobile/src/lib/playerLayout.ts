// The 16:9 video player aspect ratio (height = width * this). Shared so the
// inline player, its loading skeleton, and the watch screen's scroll math stay
// in lockstep — three independent `9 / 16` literals drifted before this.
export const PLAYER_HEIGHT_RATIO = 9 / 16

// Floating back button offsets over the full-bleed player/hero. Shared by
// the watch + series screens (todo 014); the series dock went full-bleed on
// 2026-08-18, retiring the old PLAYER_SIDE_PADDING inset.
export const BACK_BUTTON_PROPS = {
  topOffset: 10,
  sideOffset: 18,
}
