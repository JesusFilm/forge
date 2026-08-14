import { useSyncExternalStore } from "react"

import { getMiniPlayerStore } from "../lib/miniPlayer"
import type { MiniPlayerStore } from "../lib/miniPlayer/store"

/**
 * Is a mini player session holding playback right now (R9/R10)?
 *
 * A BOOLEAN, never the session object. The store replaces its snapshot on
 * every one-second position write, so a screen that subscribed to the object
 * would re-render — Home's whole feed included — once a second (KTD2).
 *
 * True for a session on the watch route too, which is deliberate: that screen
 * is the one decoder, and the surfaces this gates are all behind it.
 */
export function useMiniPlayerActive(
  store: MiniPlayerStore = getMiniPlayerStore(),
): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot() != null,
  )
}
