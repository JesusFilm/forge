import { useMemo, useSyncExternalStore } from "react"

import {
  getPlaybackRequestStore,
  type PlaybackRect,
} from "../lib/miniPlayer/playbackRequest"

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
  // A reader cover (feat-551 KTD10) draws nothing into the slot, so the
  // screen shows its own back button again.
  return (
    snapshot.rect != null && snapshot.slotId != null && snapshot.cover == null
  )
}

/**
 * Whether the one root player is playing, for layers outside the host's tree.
 *
 * The primitive is derived INSIDE the selector on purpose: every commit() gives
 * the cached snapshot a new identity, so returning the snapshot would re-render
 * this subscriber on unrelated changes (a rect update, a loadFailed flip).
 */
export function usePlaybackPlaying(): boolean {
  const store = getPlaybackRequestStore()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().playing,
  )
}

/** The resting mini player frame in window coordinates, or null (feat-551
 *  R10). It keeps one object until it moves, so a reader re-renders only then. */
export function useFloatingWindowFrame(): PlaybackRect | null {
  const store = getPlaybackRequestStore()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().windowFrame ?? null,
  )
}

/** The floating window as the reader's list of obstacles, or undefined when
 *  no window floats (feat-551 R10). */
export function useFloatingObstacles(): readonly PlaybackRect[] | undefined {
  const windowFrame = useFloatingWindowFrame()
  return useMemo(() => (windowFrame ? [windowFrame] : undefined), [windowFrame])
}
