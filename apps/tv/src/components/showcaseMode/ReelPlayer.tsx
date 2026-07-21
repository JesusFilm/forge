/**
 * The reel's playback surface (R10/R11/R18). TWO long-lived players: ordinary swaps
 * replaceAsync on the live one behind the poster; a hop preloads the next dub on the
 * standby and flips views at the boundary, so the seam stays on live frames (KTD-5).
 */

import { Image } from "expo-image"
import { useFocusEffect } from "expo-router"
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video"
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
import {
  HANDOFF_START_LEAD_SECONDS,
  PRELOAD_DEADLINE_MS,
  alignmentSeekTarget,
  preloadPollVerdict,
  resolveHopSwapMode,
  sameHopStream,
  type StandbyPreloadPhase,
} from "../../lib/showcaseMode/hopHandoff"
import { OVERLAY_CROSSFADE_MS } from "../../lib/showcaseMode/reelState"
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

// A COVERED swap (card/interstitial over the reel) holds the poster and item swap
// back until the overlay's entry dissolve is opaque — otherwise the incoming
// thumbnail (or a released surface) flashes through the half-transparent card.
const POSTER_COVER_DELAY_MS = OVERLAY_CROSSFADE_MS + 80
const SWAP_COVER_DELAY_MS = POSTER_COVER_DELAY_MS + 100

/** Matches the player's own 1s timeUpdate cadence — no point sampling finer. */
const WATCHDOG_TICK_MS = 1000

/** A paused standby emits no timeUpdate, so its preload progress is polled. */
const PRELOAD_POLL_MS = 250

/** While a flip's reveal is owed, the incoming player's playing state is polled too. */
const REVEAL_POLL_MS = 150

/** Give the flip's own play() this long before the poll starts re-issuing it. */
const REVEAL_REPLAY_AFTER_MS = 600

/** The incoming view's opacity ramp over the outgoing frame — same footage, so short. */
const HANDOFF_CROSSFADE_MS = 180

/**
 * Preload buffer target: a full hop window (10s) plus roll-through margin. AVPlayer's
 * automatic mode barely buffers a PAUSED item (~1s at the flip), so the standby gets
 * this explicit target per preload; ordinary live loads restore the library default.
 */
const PRELOAD_FORWARD_BUFFER_SECONDS = 15

export type ReelPlayerProps = {
  /** The shell's resolved stream (KTD-4). Null until this excerpt's choice lands. */
  stream: ShowcaseStream | null
  /**
   * KTD-5: the NEXT hop's stream, published while the current one plays so the
   * standby player can preload it. Null outside hop mode and past the last hop.
   */
  preloadStream: ShowcaseStream | null
  posterUrl: string | null
  /** KTD-9's source-swap guard token; bumps on every new excerpt target. */
  excerptToken: number
  /**
   * KTD-5: the swap into this stream is a hop continuation (same footage, next dub).
   * Preloaded, it flips seamlessly; missed, it masks with the poster. False for the
   * entry into the centerpiece and the exit past it — those are ordinary cuts.
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
  preloadStream,
  posterUrl,
  excerptToken,
  hopSwap,
  active,
  onPlaying,
  onEnded,
  onFailed,
}: ReelPlayerProps) {
  // CMS-sourced URLs: re-validate before they reach a decoder.
  const validStream =
    stream != null && validateStreamingUrl(stream.hls) ? stream : null
  const validPreload =
    preloadStream != null && validateStreamingUrl(preloadStream.hls)
      ? preloadStream
      : null

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

  // The library's own default, captured once so ordinary loads can restore it after
  // a preload overrode it — cross-platform-safe (0 is not "automatic" on Android).
  const defaultBufferOptionsRef = useRef<VideoPlayer["bufferOptions"] | null>(
    null,
  )
  // One setup for both players: they alternate live/standby roles every hop, and a
  // config edit reaching only one of them would desynchronize the pair silently.
  const configurePlayer = useCallback((p: VideoPlayer) => {
    p.muted = false // R10: the reel is the audio.
    p.loop = false // KTD-2: native loop re-inits HLS; the reel advances manually.
    p.timeUpdateEventInterval = 1
    defaultBufferOptionsRef.current ??= p.bufferOptions
  }, [])

  // Created ONCE each with a null source: a changing useVideoPlayer source recreates
  // the native player, which is the KTD-2 leak. Two fixed instances, views bound
  // permanently to their own player — roles (live/standby) alternate per hop instead.
  const playerA = useVideoPlayer(null, configurePlayer)
  const playerB = useVideoPlayer(null, configurePlayer)
  const [liveKey, setLiveKey] = useState<"a" | "b">("a")
  const live = liveKey === "a" ? playerA : playerB
  const standby = liveKey === "a" ? playerB : playerA
  // For timers that outlive a flip (poster reveal, fades): target the CURRENT live.
  const liveRef = useRef(live)
  liveRef.current = live

  // The standby preload machine. The ref is the machine; standbyReady mirrors a
  // finished preload into render so the gate and swap effect share one decision.
  const standbyLoadRef = useRef<{
    stream: ShowcaseStream
    phase: StandbyPreloadPhase
  } | null>(null)
  // Whether the standby-ROLE player still holds a loaded item (a decode slot).
  const standbyHoldsItemRef = useRef(false)
  const [standbyReady, setStandbyReady] = useState<ShowcaseStream | null>(null)

  // A flip whose reveal is still owed: the outgoing player keeps ROLLING as the
  // motion cover until the incoming confirms; only then do the views crossfade.
  const [pendingReveal, setPendingReveal] = useState<{ token: number } | null>(
    null,
  )
  const pendingRetiredRef = useRef<VideoPlayer | null>(null)
  /** The post-crossfade retire timer — see the reveal effect for its lifecycle. */
  const revealRetireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  // Seamless only when the standby finished preloading exactly this target; the
  // reservation is kept through confirmation so the poster cannot pop mid-flip.
  const hopMode = resolveHopSwapMode({
    hopSwap,
    targetStream: validStream,
    standbyReadyStream: standbyReady,
  })

  // Read by the end-of-window path (native emitter): when the NEXT boundary is a
  // ready flip, the outgoing player is left rolling instead of paused — it is the
  // live frame the handoff covers with until the incoming dub confirms.
  const nextFlipArmedRef = useRef(false)
  nextFlipArmedRef.current =
    validPreload != null &&
    standbyReady != null &&
    sameHopStream(standbyReady, validPreload)

  const {
    shouldPlay,
    shouldMountVideo,
    posterVisible,
    posterCrossfade,
    playIntended,
  } = computeReelPlayerGate({
    screenFocused,
    appForeground,
    active,
    hasStream: validStream !== null,
    videoReady,
    excerptToken,
    confirmedToken,
    seamlessHopSwap: hopMode === "flip",
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
  // Read at swap/poster start (async paths) — covered vs visible picks the sequencing.
  const activeRef = useRef(active)
  activeRef.current = active
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

  // Explicit target: with two players, "the" volume is whichever role owns the seam.
  const setVolumeOn = useCallback((target: VideoPlayer, value: number) => {
    try {
      target.volume = value
    } catch {
      // Native player already released; benign.
    }
  }, [])

  const fadeVolumeTo = useCallback(
    (target: VideoPlayer, to: number, durationMs: number) => {
      stopFade()
      let from = to
      try {
        from = target.volume
      } catch {
        return // Released mid-transition; nothing to ramp.
      }
      const startedAt = Date.now()
      fadeTimerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - startedAt
        setVolumeOn(
          target,
          volumeAtElapsed({ from, to, elapsedMs, durationMs }),
        )
        if (elapsedMs >= durationMs) stopFade()
      }, AUDIO_FADE_TICK_MS)
    },
    [stopFade, setVolumeOn],
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
        setVolumeOn(liveRef.current, volume)
        if (volume <= 0) stopFade()
      }
      tick()
      fadeTimerRef.current = setInterval(tick, AUDIO_FADE_TICK_MS)
    },
    [stopFade, setVolumeOn],
  )

  useEffect(() => stopFade, [stopFade])

  // ── Standby preload (KTD-5) ───────────────────────────────────────

  useEffect(() => {
    // A reservation for the imminent/settling boundary is not ours to disturb; it is
    // cleared on confirmation below, and this effect re-runs then.
    if (standbyReady != null && sameHopStream(standbyReady, validStream)) return
    if (validPreload == null) {
      standbyLoadRef.current = null
      if (standbyReady != null) setStandbyReady(null)
      // Out of hop mode the standby drops its item — a loaded paused player still
      // owns a scarce tvOS decode slot (R18's law, applied to the second player).
      if (standbyHoldsItemRef.current) {
        void standby
          .replaceAsync(null)
          .then(() => {
            // Cleared on RESOLUTION: an optimistic clear would mark the slot free
            // while a failed release still holds it.
            standbyHoldsItemRef.current = false
          })
          .catch(() => {
            datadogLog.warn("showcase_hop_standby_release_failed", {})
          })
      }
      return
    }
    const current = standbyLoadRef.current
    if (
      current != null &&
      current.phase !== "failed" &&
      sameHopStream(current.stream, validPreload)
    ) {
      return
    }
    const entry: { stream: ShowcaseStream; phase: StandbyPreloadPhase } = {
      stream: validPreload,
      phase: "loading",
    }
    standbyLoadRef.current = entry
    if (standbyReady != null) setStandbyReady(null)
    standbyHoldsItemRef.current = true
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    const startedAt = Date.now()
    const startSeconds = validPreload.window.startSeconds
    void (async () => {
      let raceTimer: ReturnType<typeof setTimeout> | null = null
      try {
        try {
          // Full-window target per preloaded item; ordinary live loads restore the
          // captured library default, so the cap stays scoped to hop preloads.
          standby.bufferOptions = {
            preferredForwardBufferDuration: PRELOAD_FORWARD_BUFFER_SECONDS,
          }
        } catch {
          // Released; the load below settles the entry.
        }
        // replaceAsync can hang on a network stall, and the poll's deadline only
        // starts after it resolves — bound it so the failure is never silent.
        await Promise.race([
          standby.replaceAsync(validPreload.hls),
          new Promise<never>((_, reject) => {
            raceTimer = setTimeout(
              () => reject(new Error("standby replaceAsync timed out")),
              PRELOAD_DEADLINE_MS,
            )
          }),
        ])
        if (cancelled || standbyLoadRef.current !== entry) return
        try {
          standby.pause()
          standby.volume = 0
          // Zero-tolerance seek to the boundary; the poll below heals the tvOS
          // dropped-seek case (see needsWindowStartSeek) that a one-shot write hits.
          standby.currentTime = startSeconds
        } catch {
          // Released mid-load; the poll's deadline settles this entry.
        }
        pollTimer = setInterval(() => {
          if (cancelled || standbyLoadRef.current !== entry) {
            if (pollTimer != null) clearInterval(pollTimer)
            return
          }
          let currentTime: number | null = null
          let bufferedPosition: number | null = null
          let statusReady = false
          try {
            currentTime = standby.currentTime
            bufferedPosition = standby.bufferedPosition
            statusReady = standby.status === "readyToPlay"
          } catch {
            // Released; the deadline will fail the entry.
          }
          const verdict = preloadPollVerdict({
            currentTime,
            startSeconds,
            bufferedPosition,
            statusReady,
            elapsedMs: Date.now() - startedAt,
          })
          if (verdict === "wait") return
          if (verdict === "reseek") {
            try {
              standby.currentTime = startSeconds
            } catch {
              // Released; the deadline will fail the entry.
            }
            return
          }
          if (pollTimer != null) clearInterval(pollTimer)
          if (verdict === "ready") {
            entry.phase = "ready"
            setStandbyReady(entry.stream)
          } else {
            entry.phase = "failed"
            datadogLog.warn("showcase_hop_preload_failed", {
              content_id: entry.stream.muxPlaybackId ?? null,
              language_slug: entry.stream.languageSlug,
              reason: "deadline",
            })
          }
        }, PRELOAD_POLL_MS)
      } catch (error) {
        if (cancelled || standbyLoadRef.current !== entry) return
        entry.phase = "failed"
        datadogLog.warn("showcase_hop_preload_failed", {
          content_id: entry.stream.muxPlaybackId ?? null,
          language_slug: entry.stream.languageSlug,
          // Sanitized: a native HLS message can embed the signed Mux URL.
          reason:
            error instanceof Error
              ? sanitizeVideoErrorMessage(error.message)
              : "unknown",
        })
      } finally {
        if (raceTimer != null) clearTimeout(raceTimer)
      }
    })()
    return () => {
      cancelled = true
      if (pollTimer != null) clearInterval(pollTimer)
      // A torn-down in-flight load restarts clean on the setup re-run (StrictMode).
      if (standbyLoadRef.current === entry && entry.phase === "loading") {
        standbyLoadRef.current = null
      }
    }
  }, [validPreload, validStream, standby, standbyReady])

  // ── Source swap / hop flip ────────────────────────────────────────

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

    if (hopSwap && target != null) {
      datadogLog.info("showcase_hop_handoff", {
        content_id: target.muxPlaybackId ?? null,
        mode: hopMode === "flip" ? "flip" : "fallback",
      })
    }

    if (hopMode === "flip" && target != null) {
      // Seamless boundary. The outgoing player is NOT paused — the end-of-window
      // path left it rolling silently, and it stays the visible motion cover until
      // the incoming dub confirms; the reveal effect owns the crossfade from here.
      let outgoingTime: number | null = null
      try {
        outgoingTime = live.currentTime
      } catch {
        // Released; the flip proceeds from the preloaded boundary.
      }
      stopFade()
      // A failure-driven advance (watchdog/error mid-window) reaches this branch with
      // the outgoing still AUDIBLE — the window-end fade only covers the natural path.
      setVolumeOn(live, 0)
      loadedStreamRef.current = target
      loadedTokenRef.current = token
      standbyLoadRef.current = null
      // The retired live keeps its item until the next preload replaces it.
      standbyHoldsItemRef.current = true
      let standbyTime: number | null = null
      try {
        standbyTime = standby.currentTime
      } catch {
        // Released; alignment falls back to the preloaded boundary.
      }
      const alignTo = alignmentSeekTarget({
        outgoingTime,
        incomingWindow: target.window,
        standbyTime,
        leadSeconds: HANDOFF_START_LEAD_SECONDS,
      })
      try {
        if (alignTo != null) standby.currentTime = alignTo
        standby.volume = 0
        if (shouldPlayRef.current) standby.play()
      } catch {
        // Released; the watchdog owns recovery for a flip that never starts.
      }
      pendingRetiredRef.current = live
      setPendingReveal({ token })
      setLiveKey((key) => (key === "a" ? "b" : "a"))
      return
    }

    // A dead flip's cover must not outlive the boundary that abandoned it: without
    // this, the rolling retired player and its reveal poll survive until the NEXT
    // confirmation — extending the double-decode window past the watchdog's skip.
    if (pendingReveal != null) {
      try {
        pendingRetiredRef.current?.pause()
      } catch {
        // Released; benign.
      }
      pendingRetiredRef.current = null
      setPendingReveal(null)
    }

    void (async () => {
      try {
        // Covered: wait out the overlay dissolve + poster cover before releasing the
        // outgoing item, so nothing beneath a half-transparent card can change.
        if (!activeRef.current) {
          await new Promise((resolve) =>
            setTimeout(resolve, SWAP_COVER_DELAY_MS),
          )
          if (swapIdRef.current !== swapId) return
        }
        try {
          // An ex-standby player carries the preload buffer cap; ordinary loads get
          // the library default back so live playback keeps automatic buffering.
          if (defaultBufferOptionsRef.current != null) {
            live.bufferOptions = defaultBufferOptionsRef.current
          }
        } catch {
          // Released; the replace below fails and reports.
        }
        await live.replaceAsync(target?.hls ?? null)
        // A newer swap already owns the player; this one's seek/play would fight it.
        if (swapIdRef.current !== swapId) return
        loadedStreamRef.current = target
        loadedTokenRef.current = token
        if (target == null) return
        // R6's bounded window: long-form starts mid-video, the seek under the poster.
        if (target.window.startSeconds > 0) {
          live.currentTime = target.window.startSeconds
        }
        // Silent BEFORE play: the poster still has a hold and a fade to run, and
        // starting at full volume is what made the incoming excerpt pop in early.
        stopFade()
        setVolumeOn(live, 0)
        // Re-read the gate at execution time. The app can background across the
        // load, and a pre-await snapshot would force audio out of a hidden screen.
        if (shouldPlayRef.current) live.play()
      } catch {
        if (swapIdRef.current === swapId) onFailed(token)
      }
    })()
  }, [
    live,
    standby,
    validStream,
    excerptToken,
    hopSwap,
    hopMode,
    pendingReveal,
    onFailed,
    finalizeQoe,
    stopFade,
    setVolumeOn,
  ])

  // ── Live-player listeners ─────────────────────────────────────────

  useEffect(() => {
    const sub = live.addListener("statusChange", ({ status, error }) => {
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
  }, [live, onFailed])

  const confirmPlayback = useCallback(() => {
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
  }, [onPlaying])

  useEffect(() => {
    const sub = live.addListener("playingChange", ({ isPlaying }) => {
      if (!isPlaying) return
      confirmPlayback()
    })
    return () => sub.remove()
  }, [live, confirmPlayback])

  // A flip's play() is issued one commit before this live player's listeners attach,
  // so its playingChange can slip through unheard; while a reveal is owed, poll the
  // player directly so a lost event can never strand the handoff on the cover. The
  // re-issued play() heals tvOS swallowing a play() queued behind a fresh seek —
  // the dropped-seek pitfall's sibling, cured at the same kind of choke point.
  useEffect(() => {
    if (pendingReveal == null) return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      let playing = false
      try {
        playing = live.playing
        if (!playing && Date.now() - startedAt >= REVEAL_REPLAY_AFTER_MS) {
          if (shouldPlayRef.current) live.play()
        }
      } catch {
        return // Released; the watchdog owns recovery.
      }
      if (playing) confirmPlayback()
    }, REVEAL_POLL_MS)
    return () => clearInterval(timer)
  }, [pendingReveal, live, confirmPlayback])

  useEffect(() => {
    const sub = live.addListener("playToEnd", () => {
      onEnded(loadedTokenRef.current)
    })
    return () => sub.remove()
  }, [live, onEnded])

  useEffect(() => {
    const sub = live.addListener("timeUpdate", ({ currentTime }) => {
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
          live.currentTime = loaded.window.startSeconds
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
      setVolumeOn(live, 0)
      // A ready flip leaves the player ROLLING past its end: the same footage
      // continues, and it is the visible motion cover until the incoming confirms.
      if (!nextFlipArmedRef.current) {
        try {
          live.pause()
        } catch {
          // Native player already released; benign.
        }
      }
      onEnded(loadedTokenRef.current)
    })
    return () => sub.remove()
  }, [live, onEnded, driveFadeOut, stopFade, setVolumeOn])

  useEffect(() => {
    shouldPlayRef.current = shouldPlay
    try {
      // Only the reel's CURRENT source may be audible. After the reel advances, the
      // outgoing source stays loaded until its replacement resolves, so resuming it
      // here would play the previous excerpt under the poster; the swap plays it.
      if (shouldPlay && loadedTokenRef.current === excerptToken) live.play()
      else if (!shouldPlay) {
        live.pause()
        // A mid-handoff background/nav-away also parks the rolling cover (R18).
        pendingRetiredRef.current?.pause()
      }
    } catch {
      // Native player already released; benign.
    }
  }, [live, shouldPlay, excerptToken])

  useEffect(() => {
    return () => {
      if (revealRetireTimerRef.current != null) {
        clearTimeout(revealRetireTimerRef.current)
        revealRetireTimerRef.current = null
      }
      try {
        playerA.pause()
      } catch {
        // Native player already released; benign.
      }
      try {
        playerB.pause()
      } catch {
        // Native player already released; benign.
      }
    }
  }, [playerA, playerB])

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
      const fadeIn = activeRef.current
        ? Animated.timing(posterOpacity, {
            toValue: 1,
            duration: POSTER_FADE_MS,
            useNativeDriver: true,
          })
        : // Covered: wait out the card's dissolve, then cover silently — a visible
          // bloom here is what flashed the incoming thumbnail through the card.
          Animated.sequence([
            Animated.delay(POSTER_COVER_DELAY_MS),
            Animated.timing(posterOpacity, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
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
    // it mirrors that sequence's timing instead. liveRef: a flip must not retime it.
    fadeInDelayRef.current = setTimeout(() => {
      fadeInDelayRef.current = null
      fadeVolumeTo(liveRef.current, 1, AUDIO_FADE_IN_MS)
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

  // KTD-5's seam: view B rides above view A, fixed z-order, and only B's opacity
  // ever animates. The crossfade waits for CONFIRMATION — revealing at the flip
  // showed the incoming player parked on its preloaded frame, which read as a
  // thumbnail card; until the new dub is actually moving, the rolling retired
  // player stays on screen, so the blend is always motion into motion.
  const viewBOpacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (confirmedToken !== excerptToken) return
    // Converge the top view to the live side on EVERY confirmation — flips reveal
    // here, and a fallback recovery from a dead flip re-homes a stranded opacity.
    const fade = Animated.timing(viewBOpacity, {
      toValue: liveKey === "b" ? 1 : 0,
      duration: HANDOFF_CROSSFADE_MS,
      useNativeDriver: true,
    })
    fade.start()
    if (pendingReveal != null) {
      const retired = pendingRetiredRef.current
      pendingRetiredRef.current = null
      setPendingReveal(null)
      if (pendingReveal.token === confirmedToken) {
        // The incoming dub is moving: ride the crossfade with the audio ramp, then
        // retire the cover and release the reservation for the next preload.
        fadeVolumeTo(live, 1, AUDIO_FADE_IN_MS)
        // Ref-held, latest-wins, cleared on UNMOUNT only: this effect re-runs the
        // instant setPendingReveal(null) lands, so a cleanup-cleared timer would die
        // before firing and the reservation would never release.
        if (revealRetireTimerRef.current != null) {
          clearTimeout(revealRetireTimerRef.current)
        }
        revealRetireTimerRef.current = setTimeout(() => {
          revealRetireTimerRef.current = null
          try {
            retired?.pause()
          } catch {
            // Released; benign.
          }
          setStandbyReady(null)
        }, HANDOFF_CROSSFADE_MS + 40)
      } else {
        // A dead flip recovered through the poster fallback: just silence the
        // rolling cover — the next preload will reclaim its player.
        try {
          retired?.pause()
        } catch {
          // Released; benign.
        }
      }
    }
    return () => fade.stop()
  }, [
    confirmedToken,
    excerptToken,
    pendingReveal,
    liveKey,
    live,
    fadeVolumeTo,
    viewBOpacity,
  ])

  // The standby's view stays mounted through the whole hop plan: its player decodes
  // the preloaded boundary frame under the live view, which is what makes the flip
  // instant. Outside hop mode only the live view holds a surface (R18).
  const hopEngaged = validPreload != null || hopSwap || standbyReady != null
  const mountA = shouldMountVideo && (liveKey === "a" || hopEngaged)
  const mountB = shouldMountVideo && (liveKey === "b" || hopEngaged)

  return (
    // No pointerEvents="none" anywhere above the VideoViews: on a fullscreen surface
    // that blacks out the AVPlayerLayer. focusable={false} on the views is the fix.
    <View style={styles.container} collapsable={false}>
      {mountA ? (
        <VideoView
          player={playerA}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit="cover"
          focusable={false}
          // Android: SurfaceViews neither blend nor stack predictably; the flip's
          // crossfade and the poster overlay both need TextureView compositing.
          surfaceType="textureView"
        />
      ) : null}
      {mountB ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: viewBOpacity }]}
          collapsable={false}
        >
          <VideoView
            player={playerB}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
            focusable={false}
            surfaceType="textureView"
          />
        </Animated.View>
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
