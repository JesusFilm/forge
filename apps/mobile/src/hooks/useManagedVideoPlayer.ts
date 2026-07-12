import { useEffect, useRef } from "react"
import { AppState } from "react-native"
import { useEvent } from "expo"
import { useVideoPlayer, type VideoPlayer } from "expo-video"

import { extractMuxPlaybackId } from "../lib/muxThumbnail"

/**
 * The one adapter over expo-video's player lifecycle (todo 016): frozen
 * creation source, replaceAsync swap with Mux-ID compare + resume, AppState
 * pause/resume, unmount pause. Consumers own their VideoView + chrome.
 */
export function useManagedVideoPlayer(
  sourceUrl: string | null,
  setup?: (player: VideoPlayer) => void,
) {
  // Source MUST be frozen: useVideoPlayer recreates/releases the player on any
  // change (dep is JSON.stringify(source)). Swap via replaceAsync on the same
  // player; a changing source = "black screen, stuck on language switch" bug.
  const creationSource = useRef(sourceUrl).current
  const setupRef = useRef(setup)
  const player = useVideoPlayer(creationSource, (p) => {
    p.muted = false
    p.loop = false
    setupRef.current?.(p)
  })

  // The source currently loaded into the player, tracked separately from the
  // frozen creationSource so swap decisions can compare against it.
  const loadedUrlRef = useRef(sourceUrl)

  useEffect(() => {
    if (!sourceUrl || sourceUrl === loadedUrlRef.current) return

    // Compare by Mux playback ID, not raw URL: two URL strings can name one
    // asset (seed URL vs resolved variant); reloading it would needlessly
    // restart playback.
    const currentId = extractMuxPlaybackId(loadedUrlRef.current)
    const nextId = extractMuxPlaybackId(sourceUrl)
    loadedUrlRef.current = sourceUrl
    if (currentId != null && nextId != null && currentId === nextId) return

    // Preserve playback across the swap: replace() drops the playing state, so
    // a mid-play swap would strand a paused frame. Resume after load.
    const wasPlaying = player.playing
    const resume = () => {
      if (!wasPlaying) return
      try {
        player.play()
      } catch {
        // Player already released.
      }
    }

    // replaceAsync loads off the main thread (replace() blocks the UI thread
    // for HLS on iOS). Fall back to the synchronous path if it rejects.
    void player
      .replaceAsync(sourceUrl)
      .then(resume)
      .catch(() => {
        try {
          player.replace(sourceUrl, true)
          resume()
        } catch {
          // Player already released.
        }
      })
  }, [sourceUrl, player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Mirror isPlaying into a ref so the AppState listener registers once on
  // [player] and reads the current value — re-subscribing per play/pause left
  // a window where a background event could be missed.
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  // Background pauses; foreground resumes ONLY if playback was active when the
  // app left — never starts a video the user had paused or never played.
  const wasPlayingRef = useRef(false)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (wasPlayingRef.current) {
          try {
            player.play()
          } catch {
            // Already released
          }
        }
      } else {
        wasPlayingRef.current = isPlayingRef.current
        try {
          player.pause()
        } catch {
          // Already released
        }
      }
    })
    return () => subscription.remove()
  }, [player])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    }
  }, [player])

  return { player, isPlaying }
}
