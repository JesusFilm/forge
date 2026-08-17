import { useCallback, useEffect, useReducer, useRef } from "react"
import {
  useCastSession,
  useCastState,
  useMediaStatus,
  useStreamPosition,
} from "react-native-google-cast"

import {
  endCastSession,
  subscribeToCastSessionEvents,
  toMediaLoadRequest,
} from "../lib/cast/castAdapter"
import type { CastMedia } from "../lib/cast/castMediaResolver"
import {
  CAST_CONNECT_TIMEOUT_MS,
  castSessionInitialState,
  castSessionReducer,
  mediaStatusToEvent,
  type CastPhase,
  type CastSessionState,
} from "../lib/cast/castSessionReducer"
import { capErrorMessage, datadogLog } from "../lib/datadog"
import { castDevicesAvailable, isRemoteCastPhase } from "../lib/playbackTarget"

export type CastPlayback = {
  /** The reducer state — the single source of truth for the session phase. */
  state: CastSessionState
  /** Friendly name of the connected device, null in Idle or when unknown. */
  deviceName: string | null
  /**
   * R2: true when the SDK reports at least one reachable receiver. Derived
   * by `castDevicesAvailable` in src/lib/playbackTarget.ts — the seam that
   * documents the no-devices vs denied-permission ambiguity.
   */
  devicesAvailable: boolean
  /** Raw receiver player state ("playing" | "paused" | ...), null with no
   *  remote media. The U4 playback target derives isPlaying from it. */
  remotePlayerState: string | null
  /** Receiver playhead in seconds (~1s cadence), null with no remote media. */
  position: number | null
  /** Remote stream duration in seconds, null until the receiver reports it. */
  duration: number | null
  load: (media: CastMedia) => void
  play: () => void
  pause: () => void
  seekTo: (positionSeconds: number) => void
  /** Explicit disconnect (KTD7 userEnd): stops the receiver too. */
  end: () => void
  /** U4 drives Failed/Ended/Finished back to Idle after local recovery. */
  reset: () => void
}

/** Teardown ends (slug change / unmount) log like the user-end runCommand. */
function endCastSessionLogged(): void {
  void endCastSession(true).catch((error: unknown) => {
    datadogLog.warn("cast.command_failed", {
      cast_command: "end_session",
      error_message: capErrorMessage(String(error)),
    })
  })
}

export function useCastPlayback({
  videoSlug,
}: {
  /** Decoded slug (KTD7): video identity, never the source URL — a dub
   *  switch changes the URL but must keep the session. */
  videoSlug: string | null
}): CastPlayback {
  const [state, dispatch] = useReducer(
    castSessionReducer,
    castSessionInitialState,
  )

  const castState = useCastState() ?? null
  // Session updates on backgrounding are ignored belt-and-braces: KTD7 says
  // AppState never ends a session (native suspension is also disabled in U2).
  const castSession = useCastSession({ ignoreSessionUpdatesInBackground: true })
  const mediaStatus = useMediaStatus()
  const streamPosition = useStreamPosition()

  // Refs the imperative callbacks read at dispatch time. phaseRef is a pure
  // mirror (render-time, the repo's latest-value idiom); positionRef is NOT —
  // load() overwrites it, so only a CHANGE may re-write it (effect below).
  const phaseRef = useRef<CastPhase>(state.phase)
  phaseRef.current = state.phase
  const positionRef = useRef<number | null>(null)
  const slugRef = useRef<string | null>(videoSlug)

  useEffect(() => {
    // Keep the LAST known position when the client tears down — Ended needs
    // it for the local seek-back after the SDK has already nulled position.
    if (streamPosition != null) positionRef.current = streamPosition
  }, [streamPosition])

  // Session lifecycle events, with the error strings useCastSession discards.
  useEffect(() => {
    return subscribeToCastSessionEvents({
      onStarting: (deviceName) => dispatch({ type: "connect", deviceName }),
      onStarted: (deviceName) =>
        dispatch({ type: "sessionStarted", deviceName }),
      onStartFailed: (errorMessage) => {
        datadogLog.warn("cast.session_start_failed", {
          error_message: capErrorMessage(errorMessage),
          content_id: slugRef.current,
        })
        dispatch({
          type: "sessionEnded",
          errorMessage,
          positionSeconds: null,
        })
      },
      onEnded: (errorMessage) => {
        if (errorMessage != null) {
          datadogLog.warn("cast.session_ended_with_error", {
            error_message: capErrorMessage(errorMessage),
            content_id: slugRef.current,
          })
        }
        dispatch({
          type: "sessionEnded",
          errorMessage,
          positionSeconds: positionRef.current,
        })
      },
    })
  }, [])

  // Covers a mount into an ALREADY-active session (no onSessionStarted will
  // fire) and enriches the device name once the async lookup resolves.
  useEffect(() => {
    if (castSession == null) return
    dispatch({ type: "sessionStarted", deviceName: null })
    let cancelled = false
    castSession.getCastDevice().then(
      (device) => {
        if (cancelled) return
        const deviceName = device?.friendlyName ?? null
        if (deviceName != null) {
          dispatch({ type: "sessionStarted", deviceName })
        }
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [castSession])

  // Receiver media status drives loaded / finished / failed.
  useEffect(() => {
    const event = mediaStatusToEvent(mediaStatus ?? null)
    if (event != null) dispatch(event)
  }, [mediaStatus])

  // Unconditional release for Connecting: keyed on the phase STRING, so
  // in-phase updates (late device name) do not restart the budget.
  useEffect(() => {
    if (state.phase !== "connecting") return
    const timer = setTimeout(
      () => dispatch({ type: "timeout" }),
      CAST_CONNECT_TIMEOUT_MS,
    )
    return () => clearTimeout(timer)
  }, [state.phase])

  // KTD7 videoChanged: end on a change of video identity (decoded slug).
  useEffect(() => {
    const previous = slugRef.current
    slugRef.current = videoSlug
    if (previous == null || videoSlug == null || previous === videoSlug) return
    if (!isRemoteCastPhase(phaseRef.current)) return
    dispatch({ type: "videoChanged", positionSeconds: positionRef.current })
    endCastSessionLogged()
  }, [videoSlug])

  // KTD7 unmount: leaving the player screen ends the session. StrictMode's
  // mount-time cleanup sees phase "idle" (no state landed yet), so it no-ops.
  useEffect(() => {
    return () => {
      if (!isRemoteCastPhase(phaseRef.current)) return
      // Runs after unmount — safe: datadogLog is not React state.
      endCastSessionLogged()
    }
  }, [])

  // One log per committed phase transition (effect-side, never in the reducer).
  const loggedPhaseRef = useRef<CastPhase>(state.phase)
  useEffect(() => {
    const previous = loggedPhaseRef.current
    if (previous === state.phase) return
    loggedPhaseRef.current = state.phase
    datadogLog.info("cast.state_change", {
      cast_state: state.phase,
      cast_prev_state: previous,
      content_id: slugRef.current,
      ...(state.phase === "failed"
        ? { cast_failure_reason: state.reason }
        : {}),
      ...(state.phase === "ended" ? { cast_end_trigger: state.trigger } : {}),
    })
  }, [state])

  const client = castSession?.client ?? null

  const load = useCallback(
    (media: CastMedia) => {
      if (client == null) return
      positionRef.current = media.startPositionSeconds
      client.loadMedia(toMediaLoadRequest(media)).catch((error: unknown) => {
        datadogLog.warn("cast.load_failed", {
          error_message: capErrorMessage(String(error)),
          content_id: slugRef.current,
        })
        dispatch({ type: "mediaFailed" })
      })
    },
    [client],
  )

  const runCommand = useCallback(
    (command: string, run: () => Promise<void>) => {
      void run().catch((error: unknown) => {
        datadogLog.warn("cast.command_failed", {
          cast_command: command,
          error_message: capErrorMessage(String(error)),
        })
      })
    },
    [],
  )

  const play = useCallback(() => {
    if (client != null) runCommand("play", () => client.play())
  }, [client, runCommand])

  const pause = useCallback(() => {
    if (client != null) runCommand("pause", () => client.pause())
  }, [client, runCommand])

  const seekTo = useCallback(
    (positionSeconds: number) => {
      if (client != null) {
        runCommand("seek", () => client.seek({ position: positionSeconds }))
      }
    },
    [client, runCommand],
  )

  const end = useCallback(() => {
    dispatch({ type: "userEnd", positionSeconds: positionRef.current })
    runCommand("end", () => endCastSession(true))
  }, [runCommand])

  const reset = useCallback(() => {
    dispatch({ type: "reset" })
  }, [])

  return {
    state,
    deviceName: state.phase === "idle" ? null : state.deviceName,
    devicesAvailable: castDevicesAvailable(castState),
    remotePlayerState: mediaStatus?.playerState ?? null,
    position: streamPosition,
    duration: mediaStatus?.mediaInfo?.streamDuration ?? null,
    load,
    play,
    pause,
    seekTo,
    end,
    reset,
  }
}
