// The 16:9 video player aspect ratio (height = width * this). Shared so the
// inline player, its loading skeleton, and the watch screen's scroll math stay
// in lockstep — three independent `9 / 16` literals drifted before this.
export const PLAYER_HEIGHT_RATIO = 9 / 16
