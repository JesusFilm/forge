/**
 * The reel's playback surface (R10/R11/R18): ONE long-lived player whose source is
 * swapped with replaceAsync behind a poster covering every swap and seek. A second
 * player is expo-video's AVPlayerViewController leak trigger (KTD-2/KTD-3).
 */

import { Image } from "expo-image"
import { useFocusEffect } from "expo-router"
import { useVideoPlayer, VideoView } from "expo-video"
import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, AppState, StyleSheet, View } from "react-native"

import { datadogLog, reportDatadogError } from "../../lib/datadog"
import { shouldCountReelRebuffer } from "../../lib/showcaseMode/showcaseTelemetry"
import type { ShowcaseStream } from "../../lib/showcaseMode/types"
import { validateStreamingUrl } from "../../lib/validateUrl"
import {
  createVideoQoeSession,
  sanitizeVideoErrorMessage,
  type VideoQoeReason,
} from "../../lib/videoQoe"
import { isAppStateForeground } from "../watch/videoBackdropGate"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { computeReelPlayerGate } from "./reelPlayerGate"
import { classifyReelWatchdog } from "./reelWatchdog"

// Hold the poster briefly over the confirmed video, then fade: absorbs the seek
// settle and gives the eye a still instead of a mid-load pop (VideoBackdrop's curve).
const POSTER_HOLD_MS = 500
const POSTER_FADE_MS = 500

/** Matches the player's own 1s timeUpdate cadence — no point sampling finer. */
const WATCHDOG_TICK_MS = 1000

export type ReelPlayerProps = {
  /** The shell's resolved stream (KTD-4). Null until this excerpt's choice lands. */
  stream: ShowcaseStream | null
  posterUrl: string | null
  /** KTD-9's source-swap guard token; bumps on every new excerpt target. */
  excerptToken: number
  /**
   * Play gate. False under chapter cards, interstitials and stills: the player stays
   * loaded and silent, so the card doubles as the next excerpt's buffer window (R17).
   */
  active: boolean
  /**
   * Each echoes back the token of the source the PLAYER held, never the live prop —
   * a native emitter cannot know the reel moved on, and the shell's guard needs the
   * stale value to drop it.
   */
  onPlaying: (excerptToken: number) => void
  onEnded: (excerptToken: number) => void
  onFailed: (excerptToken: number) => void
}

export function ReelPlayer({
  stream,
  posterUrl,
  excerptToken,
  active,
  onPlaying,
  onEnded,
  onFailed,
}: ReelPlayerProps) {
  // CMS-sourced URL: re-validate before it reaches the decoder.
  const validStream =
    stream != null && validateStreamingUrl(stream.hls) ? stream : null

  // Dropping it silently starved R16's ladder: the reducer only degrades on a
  // reported failure, so an unplayable URL parked the reel on its poster forever.
  const rejected = stream != null && validStream == null
  useEffect(() => {
    if (rejected) onFailed(excerptToken)
  }, [rejected, excerptToken, onFailed])

  const [appForeground, setAppForeground] = useState(
    isAppStateForeground(AppState.currentState),
  )
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppForeground(isAppStateForeground(next))
    })
    return () => sub.remove()
  }, [])

  // Nav-away releases the decode slot (R18): a pushed screen leaves this route
  // mounted. Setup restores what cleanup clears — StrictMode remounts in place.
  const [screenFocused, setScreenFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true)
      return () => setScreenFocused(false)
    }, []),
  )

  const [videoReady, setVideoReady] = useState(false)
  const [confirmedToken, setConfirmedToken] = useState<number | null>(null)

  const { shouldPlay, shouldMountVideo, posterVisible, posterCrossfade } =
    computeReelPlayerGate({
      screenFocused,
      appForeground,
      active,
      hasStream: validStream !== null,
      videoReady,
      excerptToken,
      confirmedToken,
    })

  // Created ONCE with a null source: a changing useVideoPlayer source releases and
  // recreates the native player. Every excerpt swap goes through replaceAsync on
  // this instance, which is what avoids the leak (KTD-2).
  const player = useVideoPlayer(null, (p) => {
    p.muted = false // R10: the reel is the audio.
    p.loop = false // KTD-2: native loop re-inits HLS; the reel advances manually.
    // Drives the bounded-window end (R6) and U7's QoE position sampling.
    p.timeUpdateEventInterval = 1
  })

  // Native emitters fire outside React's commit, so everything they read is a ref.
  // `target*` = what we asked the player to load; `loaded*` = what it actually holds.
  // They differ for the length of a swap, and conflating them skips unplayed items.
  const targetStreamRef = useRef<ShowcaseStream | null>(null)
  const targetTokenRef = useRef(excerptToken)
  const loadedStreamRef = useRef<ShowcaseStream | null>(null)
  const loadedTokenRef = useRef(excerptToken)
  const confirmedTokenRef = useRef<number | null>(null)
  const shouldPlayRef = useRef(shouldPlay)
  // Watchdog clocks. `playRequestedAt` starts when we ASK for playback, not when the
  // stream lands: the fetch owns its own timeout, and the player cannot start while a
  // chapter card holds it paused.
  const playRequestedAtRef = useRef<number | null>(null)
  const lastAdvanceAtRef = useRef<number | null>(null)
  const lastPositionRef = useRef<number | null>(null)
  const swapIdRef = useRef(0)

  // KTD-9: one QoE session per excerpt, keyed on the Mux playback id — never the
  // title (PII). The reel's language rotation means content_id changes per excerpt,
  // so a single session-wide accumulator would blur every item together.
  const qoeRef = useRef<ReturnType<typeof createVideoQoeSession> | null>(null)
  const contentIdRef = useRef<string | null>(null)

  const finalizeQoe = useCallback((reason: VideoQoeReason) => {
    // Idempotent by construction: finalize returns the summary once, so the swap
    // and the unmount can both call unconditionally and only one summary lands.
    const summary = qoeRef.current?.finalize(reason)
    if (summary != null) datadogLog.info("video_playback.summary", summary)
  }, [])

  useEffect(() => {
    // Keyed on the stream object, not the token: the shell holds the outgoing
    // excerpt's stream until the new one resolves, so a token bump alone must not
    // reload the item that is already playing.
    if (validStream === targetStreamRef.current) return
    targetStreamRef.current = validStream
    // A swap IS the outgoing excerpt's end, and this mint is the incoming session's
    // ttff origin — the instant its stream is handed to the player.
    finalizeQoe("ended")
    contentIdRef.current = validStream?.muxPlaybackId ?? null
    qoeRef.current =
      validStream != null
        ? createVideoQoeSession({ contentId: contentIdRef.current })
        : null
    // The token current when a stream lands IS that stream's token — the shell only
    // publishes a stream for the excerpt it is targeting right now.
    const token = excerptToken
    const target = validStream
    targetTokenRef.current = token
    const swapId = ++swapIdRef.current

    void (async () => {
      try {
        await player.replaceAsync(target?.hls ?? null)
        // A newer swap already owns the player; this one's seek/play would fight it.
        if (swapIdRef.current !== swapId) return
        loadedStreamRef.current = target
        loadedTokenRef.current = token
        if (target == null) return
        // R6's bounded window: long-form starts mid-video, the seek under the poster.
        if (target.window.startSeconds > 0) {
          player.currentTime = target.window.startSeconds
        }
        // Re-read the gate at execution time. The app can background across the
        // load, and a pre-await snapshot would force audio out of a hidden screen.
        if (shouldPlayRef.current) player.play()
      } catch {
        if (swapIdRef.current === swapId) onFailed(token)
      }
    })()
  }, [player, validStream, excerptToken, onFailed, finalizeQoe])

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      // Latch through `idle`: every swap blips idle, and unmounting there forces a
      // full HLS re-init — the long black pause KTD-2 exists to avoid.
      if (status === "readyToPlay") setVideoReady(true)
      else if (status === "error") {
        // A genuine error is never a swap blip. Fall back to the poster and let the
        // reel skip this item (R16) rather than strand it on a frozen frame.
        setVideoReady(false)
        // Sanitize before it leaves the device: a native HLS message can embed the
        // failing Mux URL, whose signed query string carries a token.
        const message = error?.message
        qoeRef.current?.onError(message)
        reportDatadogError(
          message != null
            ? sanitizeVideoErrorMessage(message)
            : "reel playback error",
          { content_id: contentIdRef.current, origin: "showcase_reel" },
        )
        onFailed(targetTokenRef.current)
      } else if (status === "loading") {
        // An initial load and a language-rotation swap both surface as `loading`,
        // and neither is a stall the viewer suffered (KTD-9).
        if (
          shouldCountReelRebuffer({
            confirmedToken: confirmedTokenRef.current,
            targetToken: targetTokenRef.current,
          })
        ) {
          qoeRef.current?.onRebuffer()
        }
      }
    })
    return () => sub.remove()
  }, [player, onFailed])

  useEffect(() => {
    const sub = player.addListener("playingChange", ({ isPlaying }) => {
      if (!isPlaying) return
      const token = loadedTokenRef.current
      confirmedTokenRef.current = token
      setConfirmedToken(token)
      // The stall clock starts HERE, not at the play request: a long-form item
      // seeks ~15% in before its first heartbeat, and measuring from the request
      // would call that healthy seek a stall and skip an excerpt nobody watched.
      lastAdvanceAtRef.current = Date.now()
      // Per-excerpt TTFF is a LOG FIELD, never a view timing: addDatadogTiming
      // measures from the route view's start, folding nav latency in (KTD-9).
      const ttffMs = qoeRef.current?.onFirstPlaying()
      if (ttffMs != null) {
        datadogLog.info("video_playback.ttff", {
          content_id: contentIdRef.current,
          ttff_ms: ttffMs,
        })
      }
      onPlaying(token)
    })
    return () => sub.remove()
  }, [player, onPlaying])

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      onEnded(loadedTokenRef.current)
    })
    return () => sub.remove()
  }, [player, onEnded])

  useEffect(() => {
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      // The watchdog's heartbeat: position MOVED, not merely an event arrived — a
      // frozen player still emits on the interval, reporting the same currentTime.
      if (currentTime !== lastPositionRef.current) {
        lastPositionRef.current = currentTime
        lastAdvanceAtRef.current = Date.now()
      }
      const loaded = loadedStreamRef.current
      if (loaded == null) return
      // Only a confirmed source's clock means anything: before its seek lands, a
      // long-form item still reports the OUTGOING item's position, which would trip
      // the window end instantly and skip an excerpt nobody watched.
      if (confirmedTokenRef.current !== loadedTokenRef.current) return
      // Guarded above, so this is the confirmed source's own clock: an unconfirmed
      // reading is the OUTGOING excerpt's position and would pollute watched_ms.
      qoeRef.current?.onTimeUpdate(currentTime)
      if (currentTime < loaded.window.endSeconds) return
      // Silence it now — the poster hides the picture, but this excerpt's audio
      // would otherwise run on underneath until the next stream resolves.
      try {
        player.pause()
      } catch {
        // Native player already released; benign.
      }
      onEnded(loadedTokenRef.current)
    })
    return () => sub.remove()
  }, [player, onEnded])

  useEffect(() => {
    shouldPlayRef.current = shouldPlay
    try {
      // Only the reel's CURRENT source may be audible. After the reel advances, the
      // outgoing source stays loaded until its replacement resolves, so resuming it
      // here would play the previous excerpt under the poster; the swap plays it.
      if (shouldPlay && loadedTokenRef.current === excerptToken) player.play()
      else if (!shouldPlay) player.pause()
    } catch {
      // Native player already released; benign.
    }
  }, [player, shouldPlay, excerptToken])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released; benign.
      }
    }
  }, [player])

  // Every excerpt but the last finalizes on its swap; this catches that last one plus
  // every exit, nav-away and background teardown. Without it the reel's abandonment
  // QoE — which is how most sessions actually end — would never be captured.
  useEffect(() => {
    return () => finalizeQoe("abandoned")
  }, [finalizeQoe])

  // R16's ladder is event-driven, and the two faults office wifi actually produces —
  // a source that never starts, and one that starts then freezes — emit no failure at
  // all. This clock is what turns that silence into a skip instead of a dead screen.
  useEffect(() => {
    // Re-armed per excerpt AND per pause: a card, an interstitial or a background
    // stops the player deliberately, and none of them is a stall.
    if (!shouldPlay) {
      playRequestedAtRef.current = null
      return
    }
    playRequestedAtRef.current = Date.now()
    lastAdvanceAtRef.current = null
    lastPositionRef.current = null

    const timer = setInterval(() => {
      const requestedAt = playRequestedAtRef.current
      if (requestedAt == null) return
      const now = Date.now()
      const verdict = classifyReelWatchdog({
        shouldPlay: shouldPlayRef.current,
        confirmed: confirmedTokenRef.current === excerptToken,
        msSincePlayRequested: now - requestedAt,
        msSincePlayheadAdvance:
          lastAdvanceAtRef.current == null
            ? null
            : now - lastAdvanceAtRef.current,
      })
      if (verdict === "ok") return
      // Stop the clock before reporting: the reel may hold this source loaded until
      // its replacement resolves, and a second verdict would double-count the failure.
      playRequestedAtRef.current = null
      datadogLog.warn("showcase_reel_watchdog", {
        content_id: contentIdRef.current,
        verdict,
      })
      // The live token, not an echoed one: this is a synchronous decision about the
      // excerpt the reel wants NOW, not a late native event about one it has left.
      onFailed(excerptToken)
    }, WATCHDOG_TICK_MS)
    return () => clearInterval(timer)
  }, [shouldPlay, excerptToken, onFailed])

  const posterOpacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (posterVisible) {
      // Snap whenever nothing is mounted beneath: a fade would bleed bare screen
      // background through. The gate decides — see posterCrossfade (KTD-3).
      if (!posterCrossfade) {
        posterOpacity.setValue(1)
        return
      }
      const fadeIn = Animated.timing(posterOpacity, {
        toValue: 1,
        duration: POSTER_FADE_MS,
        useNativeDriver: true,
      })
      fadeIn.start()
      return () => fadeIn.stop()
    }
    const anim = Animated.sequence([
      Animated.delay(POSTER_HOLD_MS),
      Animated.timing(posterOpacity, {
        toValue: 0,
        duration: POSTER_FADE_MS,
        useNativeDriver: true,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [posterVisible, posterCrossfade, posterOpacity])

  return (
    // No pointerEvents="none" anywhere above the VideoView: on a fullscreen surface
    // that blacks out the AVPlayerLayer. focusable={false} on the view is the fix.
    <View style={styles.container} collapsable={false}>
      {shouldMountVideo ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit="cover"
          focusable={false}
        />
      ) : null}

      {/* Above the video (KTD-3) and covering every swap, seek and unmount gap —
          the failure window reuses this same layer, never a spinner or blank. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: posterOpacity }]}
        pointerEvents="none"
        collapsable={false}
      >
        {posterUrl != null ? (
          <Image
            source={{ uri: posterUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`reel-${posterUrl}`}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallbackBg]} />
        )}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  fallbackBg: {
    backgroundColor: WATCH_THEME.below,
  },
})
