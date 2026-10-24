import { useEffect, useRef } from "react"
import { AppState } from "react-native"

import type { CastSessionState } from "../lib/cast/castSessionReducer"
import type { ProgressFeed } from "./useManagedVideoPlayer"

/**
 * U5 (KTD6/R11/AE2): drives cast playback into the watch-progress recorder
 * through the adapter's ref-stable `progressFeed` — raw ~1s position ticks
 * (the 2s sampling lives inside the recorder), the load-time tick, and the
 * forced flushes on phase transitions. The recorder stays owned by
 * `useManagedVideoPlayer`; ends triggered by videoChanged/unmount are NOT
 * flushed here — the recorder's own re-key/unmount flush records those.
 */
export type CastProgressInput = {
  /** The session reducer state — transitions drive the forced flushes. */
  state: CastSessionState
  /** Receiver playhead in seconds (~1s cadence), null with no remote media. */
  position: number | null
  /** Remote stream duration in seconds, null until the receiver reports. */
  duration: number | null
  /** The adapter's ref-stable facade — filled in by VideoPlayer. */
  feedRef: { current: ProgressFeed | null }
  /** Start position of the last receiver load: the load-time tick's
   *  fallback before the first position report. */
  getLoadStartPosition?: () => number | null
}

export function useCastProgressRecording({
  state,
  position,
  duration,
  feedRef,
  getLoadStartPosition,
}: CastProgressInput): void {
  // Last well-formed remote sample. Terminal flushes read it because the
  // Failed state carries no position and Ended's can be null.
  const lastRemoteRef = useRef<{ position: number; duration: number } | null>(
    null,
  )
  // Foreground reconcile (KTD6 limit): the JS feed does not run while the
  // app is suspended, so the first fresh report after a return flushes.
  const pendingForegroundFlushRef = useRef(false)
  // Ref-mirrored for the once-registered AppState listener.
  const remoteMediaActiveRef = useRef(state.phase === "active")
  remoteMediaActiveRef.current = state.phase === "active"
  const getLoadStartRef = useRef(getLoadStartPosition)
  getLoadStartRef.current = getLoadStartPosition

  // Position reports feed the recorder raw — gated on a real duration so
  // the recorder's lastObserved stays a writable sample.
  useEffect(() => {
    if (state.phase !== "active") return
    if (position == null || duration == null || duration <= 0) return
    feedRef.current?.onTick(position, duration)
    lastRemoteRef.current = { position, duration }
    if (pendingForegroundFlushRef.current) {
      pendingForegroundFlushRef.current = false
      feedRef.current?.flush("foreground")
    }
  }, [state.phase, position, duration, feedRef])

  // Phase transitions: the load-time tick and the terminal flushes. The
  // previous-phase guard makes StrictMode's doubled mount effects inert.
  const prevPhaseRef = useRef(state.phase)
  useEffect(() => {
    const previous = prevPhaseRef.current
    if (previous === state.phase) return
    prevPhaseRef.current = state.phase
    const feed = feedRef.current

    if (state.phase === "connecting") {
      // New session: the previous session's sample must not leak into it.
      lastRemoteRef.current = null
      pendingForegroundFlushRef.current = false
      return
    }

    if (state.phase === "active") {
      // Media loaded before any position report: one immediate tick at the
      // load's start position, so a flush that beats the first report still
      // records (AE2's guarantee). The position effect owns reported ticks.
      if (position != null) return
      const dur = duration ?? lastRemoteRef.current?.duration ?? null
      if (dur == null || dur <= 0) return
      const pos = getLoadStartRef.current?.() ?? 0
      feed?.onTick(pos, dur)
      lastRemoteRef.current = { position: pos, duration: dur }
      return
    }

    if (state.phase === "finished") {
      // AE2: the receiver finished — same handling as local playToEnd. The
      // flush records at lastObserved.duration; the tick freshens it when
      // the duration is known here.
      pendingForegroundFlushRef.current = false
      const dur = duration ?? lastRemoteRef.current?.duration ?? null
      if (dur != null && dur > 0) feed?.onTick(dur, dur)
      feed?.flush("end")
      return
    }

    if (
      state.phase === "failed" ||
      (state.phase === "ended" && state.trigger === "userEnd")
    ) {
      pendingForegroundFlushRef.current = false
      const last = lastRemoteRef.current
      // No remote media ever reported — nothing cast-side to save.
      if (last == null) return
      const pos =
        state.phase === "ended"
          ? (state.lastPositionSeconds ?? last.position)
          : last.position
      feed?.onTick(pos, last.duration)
      feed?.flush("pause")
      return
    }

    if (state.phase === "ended") {
      // videoChanged/unmount: the recorder's re-key/unmount flush owns it.
      pendingForegroundFlushRef.current = false
    }
  }, [state, position, duration, feedRef])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return
      if (remoteMediaActiveRef.current) {
        pendingForegroundFlushRef.current = true
      }
    })
    return () => subscription.remove()
  }, [])
}
