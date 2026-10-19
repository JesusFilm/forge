// A hold on either side of a playing clip plays it at 2x until the finger
// lifts, as on YouTube Shorts and Instagram Reels (owner, 2026-10-14).

/** The playback rate while the viewer holds a side. */
export const EXPLORE_FAST_RATE = 2

/** A press held this long on a side starts the fast play, in ms. */
export const EXPLORE_FAST_HOLD_MS = 250

/** Each side that a hold speeds up, as a share of the page width. */
export const EXPLORE_FAST_SIDE_SHARE = 0.25
