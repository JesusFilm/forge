import { useSyncExternalStore } from "react"

import { miniPlayerHoldsVideo } from "../lib/miniPlayer/heroYield"
import { getMiniPlayerStore } from "../lib/miniPlayer/store"

/**
 * Whether the mini-player window is holding a live video surface (R9, R10).
 *
 * A surface that mounts its own video view asks this to yield the decoder: it
 * shows its poster and stays silent until the window stops holding a video or
 * is dismissed. Each such surface subscribes for itself rather than taking the
 * answer as a prop, so a new call site cannot forget to wire it.
 */
export function useMiniPlayerHoldsVideo(): boolean {
  const store = getMiniPlayerStore()
  // Derive INSIDE the selector: the raw snapshot changes identity on every 1s
  // position tick, and this hook sits on Home's list root — comparing the
  // primitive keeps those trees from re-rendering once per second.
  return useSyncExternalStore(store.subscribe, () =>
    miniPlayerHoldsVideo(store.getSnapshot()),
  )
}
