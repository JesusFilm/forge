/**
 * The SDUI routes' half of the one-decoder rule (R9/R10).
 *
 * `app/video/[sectionKey].tsx` and `app/collection/[sectionKey].tsx` each build
 * their own player and mount their own surface, so a floating mini player over
 * either of them is two decoders, two live audio streams, and — on Android — a
 * route SurfaceView drawing over the window.
 *
 * The owner's decision (2026-08-14): the video the viewer just started WINS,
 * and the session ends. The window does not survive these two routes, and that
 * cost is accepted. The alternative — suppressing the route's own video — hides
 * the thing the viewer opened the page for.
 *
 * One helper, called at both routes. A hand-rolled copy per route is the
 * partial-rollout shape this repo has already been bitten by; the call sites
 * are held by `app/__tests__/sduiRouteYieldsMiniPlayer.guard.test.js`.
 */

import { useEffect } from "react"

import { getMiniPlayerStore } from "../lib/miniPlayer"
import type { MiniPlayerStore } from "../lib/miniPlayer/store"

/**
 * End the live mini player session when this route's own video starts playing.
 *
 * No-ops with no session, so every route may call it unconditionally.
 */
export function useEndMiniPlayerOnPlayback(
  isPlaying: boolean,
  store: MiniPlayerStore = getMiniPlayerStore(),
): void {
  useEffect(() => {
    // Keyed on playback STARTING, never on the route mounting: opening the page
    // is browsing, and a mount-keyed end would take the window away from a
    // viewer who only came to read the description.
    if (!isPlaying) return
    // Each start, not a once-per-mount latch. A native stack keeps this route
    // mounted under a watch route, so a session published there and returned to
    // would outlive a lifetime latch and put the second decoder back.
    store.end("replaced")
  }, [isPlaying, store])
}
