import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import type { VideoPlayer, VideoPlayerStatus } from "expo-video"

/**
 * Autostart + poster/veil gate for the two viewer-initiated SDUI players
 * (`video/[sectionKey]`, `collection/[sectionKey]`).
 *
 * Neither screen autostarted, while every other surface in the app starts
 * behind a spinner — so the same card read as a different product depending on
 * which shelf it came from. They failed differently: `video/[sectionKey]` sat
 * on a tap-to-play poster, and `collection/[sectionKey]` had no poster at all,
 * just a paused frame under the native transport. This gives both the
 * `VideoPlayer.tsx` behaviour without moving them onto the root host, which
 * they are deliberately excluded from (R19).
 *
 * `VideoPlayer.tsx` keeps its own richer copy because its gate also has to
 * yield to a cast session; that entanglement does not exist here.
 */

/** Mirrors VideoPlayer.tsx. A load that never starts must still release. */
export const AUTOSTART_VEIL_TIMEOUT_MS = 12000

export function useAutostartPlayback(
  player: VideoPlayer,
  sourceUrl: string | null,
  isPlaying: boolean,
): { hasStarted: boolean; awaitingAutostart: boolean } {
  const [hasStarted, setHasStarted] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  const autoPlayedRef = useRef(false)

  // Never resets: this covers the initial load only, so a later source swap
  // keeps the chrome it already had.
  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
  }, [isPlaying, hasStarted])

  // Subscribed once per PLAYER, not per source: resubscribing on a url change
  // rebuilds mid-replaceAsync and attributes a pre-swap error to the new source.
  useEffect(() => {
    const status = player.addListener(
      "statusChange",
      ({ status }: { status: VideoPlayerStatus }) =>
        setLoadFailed(status === "error"),
    )
    // Start on sourceLoad, never on the replaceAsync promise — that resolves
    // before the source is applied.
    const load = player.addListener("sourceLoad", () => {
      if (autoPlayedRef.current) return
      // Never start audio the viewer cannot see. The adapter owns the
      // foreground resume and cannot undo a play issued while backgrounded.
      if (AppState.currentState !== "active") return
      try {
        player.play()
      } catch {
        return // Released; stay unlatched so a later load can still start.
      }
      autoPlayedRef.current = true
    })
    return () => {
      try {
        status.remove()
        load.remove()
      } catch {
        // Player already released
      }
    }
  }, [player])

  // New source: re-arm the latch and seed the stop condition from the CURRENT
  // status, which covers a source that failed before this effect ran.
  useEffect(() => {
    autoPlayedRef.current = false
    setLoadTimedOut(false)
    let current: VideoPlayerStatus | null = null
    try {
      current = player.status
    } catch {
      current = null
    }
    setLoadFailed(current === "error")
  }, [player, sourceUrl])

  const awaitingAutostart =
    !hasStarted && sourceUrl != null && !loadFailed && !loadTimedOut

  // Unconditional release. A load that neither starts nor errors would
  // otherwise strand the viewer under a veil with no way out.
  useEffect(() => {
    if (!awaitingAutostart) return
    const t = setTimeout(() => setLoadTimedOut(true), AUTOSTART_VEIL_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [awaitingAutostart])

  return { hasStarted, awaitingAutostart }
}
