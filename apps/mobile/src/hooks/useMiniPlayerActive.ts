import { useCallback, useSyncExternalStore } from "react"

import { getMiniPlayerStore } from "../lib/miniPlayer"
import {
  getPlaybackClaim,
  subscribeToPlaybackClaim,
} from "../lib/miniPlayer/hostPlayer"
import type { MiniPlayerStore } from "../lib/miniPlayer/store"

/**
 * Is the one hoisted player committed to a video right now (R9/R10)?
 *
 * TWO sources, and the claim is the one that matters most. A native stack keeps
 * the previous screen mounted, so Home or a series page is still rendering while
 * the watch route it pushed loads. The session does not exist until playback
 * starts and admission latches, so a session-only test leaves that whole window
 * unguarded — two decoders on the way into every watch screen, and an audible
 * series trailer over the video the viewer just opened. The claim exists from
 * the moment the watch route mounts with a source, which is exactly that window.
 *
 * The session path stays: a floating window over a page that pushed nothing has
 * a session and no claim.
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
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeSession = store.subscribe(listener)
      const unsubscribeClaim = subscribeToPlaybackClaim(listener)
      return () => {
        unsubscribeSession()
        unsubscribeClaim()
      }
    },
    [store],
  )
  const getSnapshot = useCallback(
    () => store.getSnapshot() != null || getPlaybackClaim() != null,
    [store],
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}
