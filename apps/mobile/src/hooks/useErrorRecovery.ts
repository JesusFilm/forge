import { useCallback, useRef } from "react"
import { AppState } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { datadogLog } from "../lib/datadog"
import { extractMuxPlaybackId } from "../lib/muxThumbnail"
import { recoverPlayback, type RecoveryOutcome } from "../lib/recoverPlayback"

/**
 * Rebuilds a failed source and resumes where the viewer was (todos/024).
 *
 * A transient dropout leaves ExoPlayer in a terminal `error` status where
 * play() is a no-op, so the transport's play button silently refuses and only
 * an app restart recovers. This owns the whole recovery: what position to
 * resume from, one attempt at a time, and reporting the outcome.
 *
 * It is a hook rather than inline wiring so the behaviour is reachable from a
 * test — review found three independent ways the position restore could be
 * inert, none of which any test could see while this lived inside the chrome.
 */
export function useErrorRecovery(
  player: ExpoVideoPlayer,
  streamingUrl: string | null,
  /** True while a cast session owns playback; never start local audio then. */
  castRemoteActive = false,
  /**
   * The last position seen while the player was healthy, from the adapter's
   * own 1s poll.
   *
   * Deliberately NOT expo-video's `timeUpdate`: that event only fires when
   * `timeUpdateEventInterval` is set, which this app never does because the
   * adapter polls instead. Listening for it left the resume position stuck at
   * zero while every test passed, because the tests emitted the event by hand.
   */
  getHealthyPosition: () => number = () => 0,
): () => void {
  const getHealthyPositionRef = useRef(getHealthyPosition)
  getHealthyPositionRef.current = getHealthyPosition

  const castRemoteActiveRef = useRef(castRemoteActive)
  castRemoteActiveRef.current = castRemoteActive

  const recoveringRef = useRef(false)

  return useCallback(() => {
    if (streamingUrl == null) return
    // One recovery at a time: the button the viewer is pressing is the one that
    // looked dead, so repeat presses are expected. Each would otherwise open
    // another replaceAsync on the app's single shared player.
    if (recoveringRef.current) return
    recoveringRef.current = true

    let from = getHealthyPositionRef.current()
    try {
      const duration = player.duration
      // A position past the end would resume on a frame that no longer exists.
      if (Number.isFinite(duration) && duration > 0)
        from = Math.min(from, duration - 1)
    } catch {
      // Player already released; the raw position is the best available.
    }

    const report = (outcome: RecoveryOutcome) => {
      recoveringRef.current = false
      // Never silent: a dead-looking button is exactly the bug this fixes, so
      // both outcomes have to be answerable from logs alone.
      datadogLog.warn("video.error_recovery", {
        outcome,
        content_id: extractMuxPlaybackId(streamingUrl),
        resumed_from_seconds: Math.round(from),
      })
    }

    void recoverPlayback(
      player,
      streamingUrl,
      from,
      // Mirrors the adapter's swap resume: never start audio the viewer cannot
      // see, and never play locally while a cast session owns playback.
      () => AppState.currentState === "active" && !castRemoteActiveRef.current,
    ).then(report, () => report("failed"))
    // Released on BOTH settlement paths, so the latch never outlives its
    // recovery. `.finally()` is wrong here — it re-throws the rejection as an
    // unhandled one — and a success-only handler leaves the button dead for the
    // life of the player.
  }, [player, streamingUrl])
}
