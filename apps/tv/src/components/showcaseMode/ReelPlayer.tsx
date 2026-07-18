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
import {
  AUDIO_FADE_IN_MS,
  AUDIO_FADE_TICK_MS,
  fadeOutVolumeAt,
  shouldDriveFadeOut,
  volumeAtElapsed,
} from "../../lib/showcaseMode/audioFade"
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
import { computeReelPlayerGate, needsWindowStartSeek } from "./reelPlayerGate"
import { classifyReelWatchdog } from "./reelWatchdog"

// Hold the poster briefly over the confirmed video, then fade: absorbs the seek
// settle and gives the eye a still instead of a mid-load pop (VideoBackdrop's curve).
const POSTER_HOLD_MS = 500
const POSTER_FADE_MS = 500

// KTD-5: a hop is the SAME footage in a different dub, so its seam is a brief dim over
// the LIVE frame — never the poster (that would read as a cut). Shorter than the poster
// hold, and a DIM not a blackout: the frame stays legible so the dip reads as a
// momentary darkening synced to the audio crossfade, never a black gap (R10).
const HOP_DIP_FADE_MS = 200
const HOP_DIP_MAX_OPACITY = 0.5

/** Matches the player's own 1s timeUpdate cadence — no point sampling finer. */
const WATCHDOG_TICK_MS = 1000

export type ReelPlayerProps = {
  /** The shell's resolved stream (KTD-4). Null until this excerpt's choice lands. */
  stream: ShowcaseStream | null
  posterUrl: string | null
  /** KTD-9's source-swap guard token; bumps on every new excerpt target. */
  excerptToken: number
  /**
   * KTD-5: the swap into this stream is a hop continuation (same footage, next dub).
   * Masks with the dip over the live frame instead of the poster. False for the entry
   * into the centerpiece and the exit past it — those are ordinary content cuts.
   */
  hopSwap: boolean
  /**
   * Play gate. False under chapter cards, interstitials and stills: the player stays
   * loaded and silent, so the card doubles as the next excerpt's buffer window (R17).
   */
  active: boolean
  /**
   * A native emitter cannot know the reel moved on, so it echoes back the token of the
   * source the PLAYER held and the shell's guard drops it. Decisions made HERE and now
   * — a rejected URL, a watchdog verdict — pass the live token instead; they are about
   * the excerpt the reel is asking for, not one a late event has left behind.
   */
  onPlaying: (excerptToken: number) => void
  onEnded: (excerptToken: number) => void
  onFailed: (excerptToken: number) => void
}

export function ReelPlayer({
  stream,
  posterUrl,
  excerptToken,
  hopSwap,
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
  // Keyed on the stream OBJECT, not on `rejected`: the shell holds a rejected stream
  // until a replacement resolves, so a bare boolean re-fires on every token bump and
  // fails the next excerpts sight-unseen — three bumps and the reel is in stills.
  const reportedRejectRef = useRef<ShowcaseStream | null>(null)
  useEffect(() => {
    if (!rejected || reportedRejectRef.current === stream) return
    reportedRejectRef.current = stream
    datadogLog.warn("showcase_reel_rejected_stream", {
      content_id: stream?.muxPlaybackId ?? null,
    })
    onFailed(excerptToken)
  }, [rejected, stream, excerptToken, onFailed])

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

  const {
    shouldPlay,
    shouldMountVideo,
    posterVisible,
    posterCrossfade,
    playIntended,
    swapInFlight,
    hopDipActive,
  } = computeReelPlayerGate({
    screenFocused,
    appForeground,
    active,
    hasStream: validStream !== null,
    videoReady,
    excerptToken,
    confirmedToken,
    hopSwap,
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
  // Scoped to the ARM, unlike confirmedTokenRef, which holds a source identity for the
  // whole session. A resume re-arms without a token bump, and reusing that ref there
  // reported a cold re-buffer as already-confirmed — skipping the load budget it needs.
  const armConfirmedRef = useRef(false)
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

  // R11's crossfade is audible as well as visible. expo-video exposes no volume ramp,
  // so it is stepped from a timer; the curve and arming rule live in audioFade.ts.
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The reveal's fade-in waits out the poster hold, so it is PENDING, not running.
  // stopFade has to cancel it too, or an armed fade-out is overrun by a fade-in that
  // was scheduled before it and swells the excerpt back up as it ends.
  const fadeInDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The TOKEN this fade-out armed for, never a bare boolean. The outgoing stream keeps
  // emitting timeUpdate past its own end, and a flag reset at swap time is re-armed by
  // one of those late events — poisoning the latch so the NEXT excerpt never fades.
  const fadeOutArmedForRef = useRef<number | null>(null)

  const stopFade = useCallback(() => {
    if (fadeTimerRef.current != null) {
      clearInterval(fadeTimerRef.current)
      fadeTimerRef.current = null
    }
    if (fadeInDelayRef.current != null) {
      clearTimeout(fadeInDelayRef.current)
      fadeInDelayRef.current = null
    }
  }, [])

  const setVolume = useCallback(
    (value: number) => {
      try {
        player.volume = value
      } catch {
        // Native player already released; benign.
      }
    },
    [player],
  )

  const fadeVolumeTo = useCallback(
    (to: number, durationMs: number) => {
      stopFade()
      let from = to
      try {
        from = player.volume
      } catch {
        return // Released mid-transition; nothing to ramp.
      }
      const startedAt = Date.now()
      fadeTimerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - startedAt
        setVolume(volumeAtElapsed({ from, to, elapsedMs, durationMs }))
        if (elapsedMs >= durationMs) stopFade()
      }, AUDIO_FADE_TICK_MS)
    },
    [player, stopFade, setVolume],
  )

  // Driven off MEDIA time, not the reveal's wall-clock fade-in: re-based on every
  // timeUpdate that moved, so whichever sample arms it — and however the platform's
  // clock drifts — the 50ms tick still interpolates it down to silence at the end.
  const driveFadeOut = useCallback(
    (mediaTime: number, endSeconds: number) => {
      stopFade()
      const basedAtMedia = mediaTime
      const basedAtWall = Date.now()
      const tick = () => {
        const projected = basedAtMedia + (Date.now() - basedAtWall) / 1000
        const volume = fadeOutVolumeAt({
          remainingSeconds: endSeconds - projected,
        })
        setVolume(volume)
        if (volume <= 0) stopFade()
      }
      tick()
      fadeTimerRef.current = setInterval(tick, AUDIO_FADE_TICK_MS)
    },
    [stopFade, setVolume],
  )

  useEffect(() => stopFade, [stopFade])

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
        // Silent BEFORE play: the poster still has a hold and a fade to run, and
        // starting at full volume is what made the incoming excerpt pop in early.
        stopFade()
        setVolume(0)
        // Re-read the gate at execution time. The app can background across the
        // load, and a pre-await snapshot would force audio out of a hidden screen.
        if (shouldPlayRef.current) player.play()
      } catch {
        if (swapIdRef.current === swapId) onFailed(token)
      }
    })()
  }, [
    player,
    validStream,
    excerptToken,
    onFailed,
    finalizeQoe,
    stopFade,
    setVolume,
  ])

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
      armConfirmedRef.current = true
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
      const positionMoved = currentTime !== lastPositionRef.current
      if (positionMoved) {
        lastPositionRef.current = currentTime
        lastAdvanceAtRef.current = Date.now()
      }
      const loaded = loadedStreamRef.current
      if (loaded == null) return
      // Only a confirmed source's clock means anything: before its seek lands, a
      // long-form item still reports the OUTGOING item's position, which would trip
      // the window end instantly and skip an excerpt nobody watched.
      if (confirmedTokenRef.current !== loadedTokenRef.current) return
      // The post-swap seek can be silently dropped (item not yet seekable on tvOS);
      // heal forward until the clock is inside the window, and skip this tick's
      // QoE/fade/end checks — a pre-seek position would pollute all three.
      if (
        needsWindowStartSeek({
          currentTime,
          startSeconds: loaded.window.startSeconds,
        })
      ) {
        try {
          player.currentTime = loaded.window.startSeconds
        } catch {
          // Native player already released; the next swap owns recovery.
        }
        return
      }
      // Guarded above, so this is the confirmed source's own clock: an unconfirmed
      // reading is the OUTGOING excerpt's position and would pollute watched_ms.
      qoeRef.current?.onTimeUpdate(currentTime)
      // Ramp down INTO the end, not out of it: the pause below is the hard cut the
      // viewer hears, and a fade past the end would play the credits R6 keeps clear.
      if (
        shouldDriveFadeOut({
          armedForToken: fadeOutArmedForRef.current,
          loadedToken: loadedTokenRef.current,
          positionMoved,
          currentTime,
          window: loaded.window,
        })
      ) {
        fadeOutArmedForRef.current = loadedTokenRef.current
        driveFadeOut(currentTime, loaded.window.endSeconds)
      }
      if (currentTime < loaded.window.endSeconds) return
      // Silence it now — the poster hides the picture, but this excerpt's audio
      // would otherwise run on underneath until the next stream resolves.
      stopFade()
      setVolume(0)
      try {
        player.pause()
      } catch {
        // Native player already released; benign.
      }
      onEnded(loadedTokenRef.current)
    })
    return () => sub.remove()
  }, [player, onEnded, driveFadeOut, stopFade, setVolume])

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
    // Armed on INTENT, not readiness: a source that never starts never reports itself
    // ready, so arming on the play gate would disarm the load half of this watchdog
    // for the very fault it exists to catch. Re-armed per excerpt and per pause.
    if (!playIntended) {
      playRequestedAtRef.current = null
      return
    }
    playRequestedAtRef.current = Date.now()
    lastAdvanceAtRef.current = null
    lastPositionRef.current = null
    // Cleared WITH the heartbeat it is paired to. A resume that never delivers a frame
    // otherwise reads as confirmed-but-silent, which is the one state no deadline covers.
    armConfirmedRef.current = false

    const timer = setInterval(() => {
      const requestedAt = playRequestedAtRef.current
      if (requestedAt == null) return
      const now = Date.now()
      const verdict = classifyReelWatchdog({
        // The interval exists only while intent holds — the effect tears it down
        // otherwise — so the closure value is current by construction, never stale.
        playIntended,
        // Both halves: this arm saw a frame, AND it was this excerpt's. Either alone
        // lets a stale confirmation hand a cold re-buffer the tighter stall budget.
        confirmed:
          armConfirmedRef.current && confirmedTokenRef.current === excerptToken,
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
  }, [playIntended, excerptToken, onFailed])

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
    // The audio rides the reveal, not the play() that precedes it by the whole hold.
    // Volume is a JS property, so it cannot share the native-driven opacity value —
    // it mirrors that sequence's timing instead.
    fadeInDelayRef.current = setTimeout(() => {
      fadeInDelayRef.current = null
      fadeVolumeTo(1, AUDIO_FADE_IN_MS)
    }, POSTER_HOLD_MS)
    const scheduled = fadeInDelayRef.current
    return () => {
      anim.stop()
      // Only ever cancel THIS effect's own pending reveal — stopFade clears whatever
      // is outstanding, and a re-render must not kill a fade another path started.
      if (fadeInDelayRef.current === scheduled) {
        clearTimeout(scheduled)
        fadeInDelayRef.current = null
      }
    }
  }, [posterVisible, posterCrossfade, posterOpacity, fadeVolumeTo])

  // KTD-5's hop seam. The dip fades IN over the live frame as a hop swap starts and OUT
  // once the next dub confirms; the audio rides the fade-out (the swap muted the player).
  const hopDipOpacity = useRef(new Animated.Value(0)).current
  // Body-mutated, not cleanup-mutated: setup re-derives it from hopDipActive each run, so
  // a StrictMode remount can't poison it. Gates the audio reveal to a real dip→confirm.
  const hopDipWasActiveRef = useRef(false)
  // Render mirror so the reveal branch can tell a genuine confirmation apart from a
  // lifecycle drop (background/nav-away/plan-exit) without widening the effect's deps.
  const hopRevealEligibleRef = useRef(false)
  hopRevealEligibleRef.current = !swapInFlight && shouldMountVideo
  useEffect(() => {
    if (hopDipActive) {
      hopDipWasActiveRef.current = true
      const dipIn = Animated.timing(hopDipOpacity, {
        toValue: HOP_DIP_MAX_OPACITY,
        duration: HOP_DIP_FADE_MS,
        useNativeDriver: true,
      })
      dipIn.start()
      return () => dipIn.stop()
    }
    // Only reveal after a dip actually ran — never on mount or an ordinary swap, where
    // the poster path already owns the audio fade-in.
    if (!hopDipWasActiveRef.current) return
    hopDipWasActiveRef.current = false
    const dipOut = Animated.timing(hopDipOpacity, {
      toValue: 0,
      duration: HOP_DIP_FADE_MS,
      useNativeDriver: true,
    })
    dipOut.start()
    // Reveal ONLY on a genuine confirmation. A lifecycle drop (backgrounding, nav-away,
    // exhausted plan) would otherwise ramp a muted mid-swap player back to full volume,
    // and the resume would play un-dipped audio; the poster path owns those seams.
    if (hopRevealEligibleRef.current) fadeVolumeTo(1, AUDIO_FADE_IN_MS)
    return () => dipOut.stop()
  }, [hopDipActive, hopDipOpacity, fadeVolumeTo])

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

      {/* KTD-5's hop seam: a brief dim over the LIVE frame, below the poster so the
          poster still owns lifecycle/background gaps. Zero opacity except mid-hop-swap. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.hopDip,
          { opacity: hopDipOpacity },
        ]}
        pointerEvents="none"
        collapsable={false}
      />

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
  hopDip: {
    backgroundColor: WATCH_THEME.below,
  },
})
