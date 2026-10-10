import { useEffect, useRef, useSyncExternalStore } from "react"

import {
  clipYieldsToRoot,
  stepTakeover,
  type PendingTakeover,
} from "../lib/explore/takeover"
import { getPlaybackRequestStore } from "../lib/miniPlayer/playbackRequest"
import { getMiniPlayerStore } from "../lib/miniPlayer/store"
import { beginPlaybackInterruption } from "../lib/playbackInterruption"

/**
 * KTD10: yields continuously while focused, as `heroYield.ts` does. The watch
 * page's session can start in the same commit as the focus, so one check on
 * the focus event would miss it.
 */

export type ExploreTakeoverInput = {
  /** Whether the Explore tab has focus. Nothing runs without it. */
  focused: boolean
  /** A rise of the root player's `playing` flag: dispatch `systemPause`. */
  onSystemPause: () => void
}

export type ExploreTakeover = {
  /** `clipYieldsToRoot(...)`: pass to `useFeedPlayers` and `useClipAutostart`. */
  yieldsToRoot: boolean
}

function subscribeRoot(listener: () => void): () => void {
  const stopSession = getMiniPlayerStore().subscribe(listener)
  const stopRequest = getPlaybackRequestStore().subscribe(listener)
  return () => {
    stopSession()
    stopRequest()
  }
}

/** A primitive, so a position tick does not re-render the feed. */
function readYieldsToRoot(): boolean {
  const root = getPlaybackRequestStore().getSnapshot()
  return clipYieldsToRoot({
    rootPlaying: root.playing,
    rootHasRequest: root.request != null,
    pipHold: getMiniPlayerStore().getSnapshot().pipHold,
  })
}

export function useExploreTakeover(
  input: ExploreTakeoverInput,
): ExploreTakeover {
  const { focused, onSystemPause } = input

  // A caller that passes an inline callback must not re-arm the edge each render.
  const onSystemPauseRef = useRef(onSystemPause)
  useEffect(() => {
    onSystemPauseRef.current = onSystemPause
  }, [onSystemPause])

  useEffect(() => {
    if (!focused) return
    const sessions = getMiniPlayerStore()
    // Scoped to this focus, so a blur cancels a pending takeover.
    let pending: PendingTakeover | null = null
    const evaluate = () => {
      const step = stepTakeover({
        snapshot: sessions.getSnapshot(),
        focused: true,
        pending,
      })
      pending = step.pending
      // Takeover never resumes the root player, so it drops the resume handle.
      if (step.pauseRoot) beginPlaybackInterruption()
      if (step.dismiss) sessions.requestDismiss()
    }
    evaluate()
    return sessions.subscribe(evaluate)
  }, [focused])

  useEffect(() => {
    if (!focused) return
    const requests = getPlaybackRequestStore()
    // Seeded from the store: a root player already playing at focus is no edge.
    let playing = requests.getSnapshot().playing
    return requests.subscribe(() => {
      const next = requests.getSnapshot().playing
      if (next && !playing) onSystemPauseRef.current()
      playing = next
    })
  }, [focused])

  const yieldsToRoot = useSyncExternalStore(subscribeRoot, readYieldsToRoot)
  return { yieldsToRoot }
}
