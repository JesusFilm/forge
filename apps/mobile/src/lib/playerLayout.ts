// The 16:9 video player aspect ratio (height = width * this). Shared so the
// inline player, its loading skeleton, and the watch screen's scroll math stay
// in lockstep — three independent `9 / 16` literals drifted before this.
export const PLAYER_HEIGHT_RATIO = 9 / 16

// The top of the player's route buttons (AirPlay, cast, settings).
export const PLAYER_ROUTE_ROW_TOP = 8

// The floating back button's glass circle; the top bar's back circle matches
// it (R9). Apple's press response only sees a touch on the glass, so the glass
// is 44pt and its ring is at most 6pt (owner, 2026-10-19).
export const FLOATING_BACK_SIZE = 44

// Floating back button offsets over the full-bleed player/hero, shared by the
// watch + series screens (todo 014). The circle and the route buttons are both
// 44pt, so one top keeps their centres level (owner, 2026-10-19).
export const BACK_BUTTON_PROPS = {
  topOffset: PLAYER_ROUTE_ROW_TOP,
  sideOffset: 18,
}

// Side inset of the player's edge controls (time pill, fullscreen, route row);
// the double-tap skip pill lines up with them. The inline seek bar cancels it
// so the track reaches the player's edges.
export const PLAYER_BAR_PADDING_H = 12
