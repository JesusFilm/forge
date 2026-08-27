import { useSyncExternalStore } from "react"

import { getPlaybackRequestStore } from "../lib/miniPlayer/playbackRequest"

/**
 * Whether the root playback host is currently drawing its video view into a
 * mounted surface (U6).
 *
 * A screen asks this to stop drawing chrome the host now covers: the host paints
 * above the whole stack, so anything a route renders over the player rect is
 * behind an opaque video surface. The host renders that chrome instead.
 */
export function usePlaybackFrameVisible(): boolean {
  const store = getPlaybackRequestStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return snapshot.rect != null && snapshot.slotId != null
}

/**
 * Whether the one root player is playing, for layers outside the host's tree.
 *
 * The primitive is derived INSIDE the selector on purpose: the raw snapshot
 * takes a new identity on every position tick, so returning it would re-render
 * every subscriber once a second.
 */
export function usePlaybackPlaying(): boolean {
  const store = getPlaybackRequestStore()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().playing,
  )
}
