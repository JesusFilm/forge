/**
 * The hop handoff's stateful machinery (KTD-5): live/standby role alternation, the
 * standby preload machine, and the reveal-on-confirmation crossfade. Decisions stay
 * pure in lib/showcaseMode/hopHandoff.ts; ReelPlayer keeps players, listeners, audio,
 * poster and watchdog, and drives this hook at boundaries via flip/abandonDeadFlip.
 */

import type { VideoPlayer } from "expo-video"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react"
import { Animated } from "react-native"

import { datadogLog } from "../../lib/datadog"
import { AUDIO_FADE_IN_MS } from "../../lib/showcaseMode/audioFade"
import {
  HANDOFF_START_LEAD_SECONDS,
  PRELOAD_DEADLINE_MS,
  alignmentSeekTarget,
  preloadPollVerdict,
  resolveHopSwapMode,
  resolvePreloadAction,
  sameHopStream,
  standbyMountEngaged,
  type HopSwapMode,
  type StandbyPreloadPhase,
} from "../../lib/showcaseMode/hopHandoff"
import type { ShowcaseStream } from "../../lib/showcaseMode/types"
import { sanitizeVideoErrorMessage } from "../../lib/videoQoe"

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

export type UseHopHandoffArgs = {
  playerA: VideoPlayer
  playerB: VideoPlayer
  /** The reel's validated current target stream. */
  validStream: ShowcaseStream | null
  /** The validated next-hop stream the standby should preload. */
  validPreload: ShowcaseStream | null
  /** The swap into the current target is a hop continuation. */
  hopSwap: boolean
  excerptToken: number
  confirmedToken: number | null
  /** ReelPlayer's play gate mirror — read at flip time and by the poll's re-issue. */
  shouldPlayRef: MutableRefObject<boolean>
  /** ReelPlayer's confirmation seam; the poll calls it when playingChange was lost. */
  confirmPlayback: () => void
  /** ReelPlayer's audio ramp (shared with the poster path). */
  fadeVolumeTo: (target: VideoPlayer, to: number, durationMs: number) => void
}

export type HopHandoff = {
  live: VideoPlayer
  standby: VideoPlayer
  /** flip = seamless boundary; fallback = poster-masked swap; none = ordinary cut. */
  hopMode: HopSwapMode
  /** Read by the end-of-window path: a ready flip leaves the outgoing rolling. */
  nextFlipArmedRef: MutableRefObject<boolean>
  /** View B's opacity — B rides above A and only B ever animates. */
  viewBOpacity: Animated.Value
  /** The second decode slot is engaged; mount both views. */
  hopEngaged: boolean
  /** Execute a seamless boundary into `target` (caller did its own bookkeeping). */
  flip: (args: { target: ShowcaseStream; token: number }) => void
  /** A non-flip boundary abandons any dead flip's still-rolling cover. */
  abandonDeadFlip: () => void
  /** Park the rolling cover on background/nav-away mid-handoff (R18). */
  pauseRetiredCover: () => void
}

export function useHopHandoff({
  playerA,
  playerB,
  validStream,
  validPreload,
  hopSwap,
  excerptToken,
  confirmedToken,
  shouldPlayRef,
  confirmPlayback,
  fadeVolumeTo,
}: UseHopHandoffArgs): HopHandoff {
  const [liveKey, setLiveKey] = useState<"a" | "b">("a")
  const live = liveKey === "a" ? playerA : playerB
  const standby = liveKey === "a" ? playerB : playerA

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
  // Mirror for abandonDeadFlip, which callers invoke from their own effects.
  const pendingRevealRef = useRef(pendingReveal)
  pendingRevealRef.current = pendingReveal
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

  // ── Standby preload ───────────────────────────────────────────────

  useEffect(() => {
    const current = standbyLoadRef.current
    // The decision table lives in hopHandoff.ts (tested); this effect only executes.
    const action = resolvePreloadAction({
      targetStream: validStream,
      preloadStream: validPreload,
      reservedStream: standbyReady,
      loadingStream:
        current != null && current.phase !== "failed" ? current.stream : null,
    })
    if (action === "hold" || action === "keep") return
    if (validPreload == null) {
      // action === "release"
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

  // ── Boundary actions ──────────────────────────────────────────────

  const flip = useCallback(
    ({ target, token }: { target: ShowcaseStream; token: number }) => {
      // Synchronous: the flip must not leave a frame where neither player owns the
      // screen. Native events queue behind this task, so the caller's post-flip
      // listeners attach before the new live's playingChange can arrive.
      let outgoingTime: number | null = null
      try {
        outgoingTime = live.currentTime
      } catch {
        // Released; the flip proceeds from the preloaded boundary.
      }
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
    },
    [live, standby, shouldPlayRef],
  )

  const abandonDeadFlip = useCallback(() => {
    // A dead flip's cover must not outlive the boundary that abandoned it: without
    // this, the rolling retired player and its reveal poll survive until the NEXT
    // confirmation — extending the double-decode window past the watchdog's skip.
    if (pendingRevealRef.current == null) return
    try {
      pendingRetiredRef.current?.pause()
    } catch {
      // Released; benign.
    }
    pendingRetiredRef.current = null
    setPendingReveal(null)
  }, [])

  const pauseRetiredCover = useCallback(() => {
    try {
      pendingRetiredRef.current?.pause()
    } catch {
      // Released; benign.
    }
  }, [])

  // ── Reveal on confirmation ────────────────────────────────────────

  // A flip's play() is issued one commit before the live player's listeners attach,
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
  }, [pendingReveal, live, confirmPlayback, shouldPlayRef])

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

  useEffect(() => {
    return () => {
      if (revealRetireTimerRef.current != null) {
        clearTimeout(revealRetireTimerRef.current)
        revealRetireTimerRef.current = null
      }
    }
  }, [])

  // The standby's view stays mounted through the whole hop plan: its player decodes
  // the preloaded boundary frame under the live view, which is what makes the flip
  // instant. Outside hop mode only the live view holds a surface (R18).
  const hopEngaged = standbyMountEngaged({
    preloadStream: validPreload,
    hopSwap,
    reservedStream: standbyReady,
  })

  return {
    live,
    standby,
    hopMode,
    nextFlipArmedRef,
    viewBOpacity,
    hopEngaged,
    flip,
    abandonDeadFlip,
    pauseRetiredCover,
  }
}
