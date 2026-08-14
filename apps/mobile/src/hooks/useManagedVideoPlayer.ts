import { useCallback, useEffect, useRef } from "react"
import { AppState } from "react-native"
import { useEvent } from "expo"
import { useVideoPlayer, type VideoPlayer } from "expo-video"

import { extractMuxPlaybackId } from "../lib/muxThumbnail"
import { datadogLog } from "../lib/datadog"
import {
  createProgressRecorder,
  type ProgressIdentity,
  type ProgressRecorder,
} from "../lib/watchProgress/recorder"
import {
  applyLocalProgress,
  bufferProgressIntent,
} from "../lib/watchProgress/store"
import { noteSignedOutPlaybackStop } from "../lib/watchProgress/signInPrompt"
import {
  getProgressSync,
  getSignedInAccountId,
} from "../lib/watchProgress/syncClient"
import {
  createVideoQoeSession,
  shouldCountRebuffer,
  type VideoQoeReason,
  type VideoQoeSession,
} from "../lib/videoQoe"
import { shouldPauseOnAppStateChange } from "../lib/pipPolicy"
import { isPictureInPictureActive } from "../lib/miniPlayer/pipLatch"
import type { SessionEndReason } from "../lib/miniPlayer/types"
import type { FlushTrigger } from "../lib/watchProgress/recorder"

/**
 * The progress trigger each named end reports (R16). Explicit rather than
 * derived, so a new reason has to state what it means for the saved position.
 *
 * `failed` writes the position the stream died at, which is what a dismissal
 * writes too — the difference between them is the telemetry reason, not the
 * bookmark.
 */
const FLUSH_TRIGGER_FOR_END: Record<SessionEndReason, FlushTrigger> = {
  ended: "end",
  replaced: "swap",
  dismissed: "dismiss",
  failed: "dismiss",
  signout: "signout",
}

// Playhead watchdog (R39): poll currentTime while the player reports playing and
// is NOT buffering; if it stays frozen this long, emit one stall. 3s (not sub-1s)
// keeps normal ≤1s hitches out — the target is the black-frame/stuck-at-0:00 freeze.
const STALL_POLL_MS = 1000
const STALL_THRESHOLD_MS = 3000
// Float jitter: an advance under this counts as "not moving".
const POSITION_EPSILON_S = 0.25

/**
 * The one adapter over expo-video's player lifecycle (todo 016): frozen
 * creation source, replaceAsync swap with Mux-ID compare + resume, AppState
 * pause/resume, unmount pause. Consumers own their VideoView + chrome.
 *
 * Progress recording (KTD5) lives INSIDE the adapter and no-ops unless the
 * caller passes `options.progress` — the muted hero pager and SDUI hero use
 * raw useVideoPlayer and never reach this hook, so they are excluded
 * structurally.
 */
export function useManagedVideoPlayer(
  sourceUrl: string | null,
  setup?: (player: VideoPlayer) => void,
  options?: {
    progress?: ProgressIdentity | null
    /** The same 1s poll the recorder samples, handed to the caller (U6). A
     *  second interval over the same native player would double the reads and
     *  drift against this one. */
    onProgress?: (positionSeconds: number, durationSeconds: number) => void
  },
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

  // Whether the app is foregrounded right now. A swap's replaceAsync can outlive
  // any departure, so resume() reads this and never force-plays into a state the
  // viewer left; the 'active' handler restores playback from wasPlayingRef.
  const isForegroundRef = useRef(true)

  // Playback QoE (R36/R38): pure accumulator fed by the listeners below,
  // emitting once on session end. content_id is the Mux playback id, so the
  // summary stays PII-free.
  const qoeRef = useRef<VideoQoeSession | null>(null)
  const sessionContentIdRef = useRef<string | null>(null)
  const sessionSourceRef = useRef<"offline" | "network">("network")
  const sessionStartedRef = useRef(false)
  // Rebuffer gate: has playback begun, and is a source swap mid-flight.
  const hasStartedRef = useRef(false)
  const isSwappingRef = useRef(false)
  // Has a NAMED end already run for the live session? The teardown cleanups
  // stay as safety nets (KTD13) and must not overwrite a real reason with
  // "abandoned" or "unmount" — the defect being fixed is attribution, not
  // double-fire. Declared before startQoeSession, which resets it.
  const explicitEndRef = useRef(false)

  const emitQoeSummary = useCallback((reason: VideoQoeReason) => {
    const summary = qoeRef.current?.finalize(reason)
    qoeRef.current = null
    if (summary == null) return
    // Skip an empty session (e.g. a null→real source swap before any playback).
    if (
      summary.ttff_ms == null &&
      summary.rebuffer_count === 0 &&
      summary.error_count === 0 &&
      (summary.watched_ms ?? 0) === 0
    )
      return
    datadogLog.info("video.qoe", {
      ...summary,
      playback_source: sessionSourceRef.current,
    })
  }, [])

  const startQoeSession = useCallback((url: string | null) => {
    // A new session has its own end, so the previous session's named end must
    // not suppress it.
    explicitEndRef.current = false
    sessionContentIdRef.current = extractMuxPlaybackId(url)
    // R38: a completed download plays from file://, a stream from https.
    sessionSourceRef.current =
      url != null && url.startsWith("file://") ? "offline" : "network"
    hasStartedRef.current = false
    qoeRef.current = createVideoQoeSession({
      contentId: sessionContentIdRef.current,
    })
  }, [])

  if (!sessionStartedRef.current) {
    sessionStartedRef.current = true
    startQoeSession(creationSource)
  }

  // Progress recorder (KTD5): one per identity, so an episode swap flushes
  // the departing video before re-keying.
  const progressIdentity = options?.progress ?? null
  const recorderRef = useRef<ProgressRecorder | null>(null)
  // languageSlug is part of the key: an audio-language switch mid-playback
  // must re-key so the departing position flushes under the language it was
  // actually watched in, rather than being stamped with the new one.
  const recorderKey = progressIdentity
    ? `${progressIdentity.videoId ?? ""}|${progressIdentity.videoSlug ?? ""}|${
        progressIdentity.languageSlug ?? ""
      }`
    : null
  const identityRef = useRef(progressIdentity)
  identityRef.current = progressIdentity

  // Through a ref: the poll below is keyed on [player, isPlaying], so a caller
  // passing a fresh closure per render would tear down and re-arm the interval
  // on every tick.
  const onProgressRef = useRef(options?.onProgress)
  onProgressRef.current = options?.onProgress

  // Is the next recorder cleanup a RE-KEY (episode swap) or a real unmount?
  // React does not say, and only the departing recorder holds the departing
  // position — so the flush has to happen in that cleanup, and only a
  // render-time key comparison can tell it which trigger to use. A true
  // unmount runs no render first, so this stays false there.
  const previousRecorderKeyRef = useRef(recorderKey)
  const recorderIsRekeyingRef = useRef(false)
  if (previousRecorderKeyRef.current !== recorderKey) {
    previousRecorderKeyRef.current = recorderKey
    recorderIsRekeyingRef.current = true
  }
  // Effect, not render: flush() buffers an intent and dispatches a network
  // drain, so the departing video's write must not fire mid-render.
  useEffect(() => {
    const identity = identityRef.current
    recorderRef.current = identity
      ? createProgressRecorder(identity, {
          getAccountId: getSignedInAccountId,
          bufferIntent: bufferProgressIntent,
          requestDrain: (drainOptions) =>
            void getProgressSync().drainIntents(drainOptions),
          applyLocal: applyLocalProgress,
          onSignedOutStop: noteSignedOutPlaybackStop,
        })
      : null
    return () => {
      // Record the departing position under the reason that actually applies.
      // A named end (dismiss, sign-out, playback end) has already written it,
      // and this net must not overwrite that attribution with "unmount" —
      // which is the misreporting R16 exists to fix.
      const rekeying = recorderIsRekeyingRef.current
      recorderIsRekeyingRef.current = false
      if (!explicitEndRef.current) {
        recorderRef.current?.flush(rekeying ? "swap" : "unmount")
      }
      recorderRef.current = null
    }
  }, [recorderKey])

  /**
   * The explicit session boundary (R16/R17). One entry point, so no call site
   * has to remember to stop the previous session first: it flushes the
   * departing position under the reason's own trigger and closes the quality
   * session with that reason, then re-arms for whatever plays next.
   *
   * Idempotent per session. A named end followed by React teardown reports
   * once, under the name — which is the whole point, because teardown's
   * "abandoned" is what used to overwrite it.
   */
  const endSession = useCallback(
    (reason: SessionEndReason) => {
      if (explicitEndRef.current) return
      explicitEndRef.current = true
      recorderRef.current?.flush(FLUSH_TRIGGER_FOR_END[reason])
      emitQoeSummary(reason)
    },
    [emitQoeSummary],
  )

  useEffect(() => {
    if (!sourceUrl || sourceUrl === loadedUrlRef.current) return

    // Compare by Mux playback ID, not raw URL: two URL strings can name one
    // asset (seed URL vs resolved variant); reloading it would needlessly
    // restart playback.
    const currentId = extractMuxPlaybackId(loadedUrlRef.current)
    const nextId = extractMuxPlaybackId(sourceUrl)
    loadedUrlRef.current = sourceUrl
    if (currentId != null && nextId != null && currentId === nextId) return

    // A genuine cross-asset swap ends this QoE session and opens a new one so
    // watched_ms/rebuffers/source attribute to the right asset (R36/R38).
    // "replaced" rather than "abandoned": the viewer changed episode, they did
    // not walk away (R17). Only the telemetry side is closed here — the
    // departing POSITION belongs to the departing recorder, which this effect
    // can no longer reach, so the re-key cleanup above flushes it under "swap".
    emitQoeSummary("replaced")
    startQoeSession(sourceUrl)
    isSwappingRef.current = true

    // Preserve playback across the swap: replace() drops the playing state, so
    // a mid-play swap would strand a paused frame. Resume after load.
    const wasPlaying = player.playing
    const resume = () => {
      // Bail if the app backgrounded while replaceAsync was in flight — the
      // AppState 'active' handler re-resumes on foreground via wasPlayingRef.
      if (!wasPlaying || !isForegroundRef.current) return
      try {
        player.play()
      } catch {
        // R16: a genuine resume failure (player released mid-swap) — the
        // "came back and it was frozen" bug; not the unmount-pause noise.
        datadogLog.warn("video.resume_failed", {
          content_id: nextId,
          surface: "swap",
        })
      }
    }

    // replaceAsync loads off the main thread (replace() blocks the UI thread
    // for HLS on iOS). Fall back to the synchronous path if it rejects.
    void player
      .replaceAsync(sourceUrl)
      .then(resume)
      .catch(() => {
        datadogLog.warn("video.swap_fallback", { content_id: nextId })
        try {
          player.replace(sourceUrl, true)
          resume()
        } catch {
          datadogLog.error("video.swap_failed", { content_id: nextId })
        }
      })
      .finally(() => {
        isSwappingRef.current = false
      })
  }, [sourceUrl, player, emitQoeSummary, startQoeSession])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Mirror isPlaying into a ref so the AppState listener registers once on
  // [player] and reads the current value — re-subscribing per play/pause left
  // a window where a background event could be missed.
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    const wasPlaying = isPlayingRef.current
    isPlayingRef.current = isPlaying
    // R36: first play records TTFF (creation→now) into the session summary and
    // opens the rebuffer gate. onFirstPlaying is idempotent per session.
    if (isPlaying) {
      hasStartedRef.current = true
      qoeRef.current?.onFirstPlaying()
    } else if (wasPlaying) {
      // A real pause (not initial mount) forces a progress write (KTD5).
      recorderRef.current?.flush("pause")
    }
  }, [isPlaying])

  // Background pauses; foreground resumes ONLY if playback was active when the
  // app left — never starts a video the user had paused or never played.
  const wasPlayingRef = useRef(false)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        isForegroundRef.current = true
        if (wasPlayingRef.current) {
          try {
            player.play()
          } catch {
            // R16: resume-after-background play() failed (released while
            // suspended) — the silent "frozen after foregrounding" complaint.
            datadogLog.warn("video.resume_failed", {
              content_id: extractMuxPlaybackId(loadedUrlRef.current),
              surface: "foreground",
            })
          }
        }
        return
      }

      // Every departure re-stamps the latch, even one this app does not pause
      // for: 'active' resumes from it unconditionally, so a latch left over
      // from an earlier departure resumes a video the viewer paused since.
      isForegroundRef.current = false
      wasPlayingRef.current = isPlayingRef.current

      // Only the PAUSE is conditional. An 'inactive' blip (app switcher,
      // control centre, a call banner) and picture-in-picture ENTRY — which
      // Android reports as 'background', not 'inactive' (R13) — keep playing.
      if (!shouldPauseOnAppStateChange(nextState, isPictureInPictureActive()))
        return
      recorderRef.current?.flush("background")
      try {
        player.pause()
      } catch {
        // Already released
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

  // R36: statusChange feeds the QoE session — 'error' is a sanitized error, and
  // a post-start 'loading' that is not a seek/swap is a genuine rebuffer.
  useEffect(() => {
    // Playback end records the completed range (KTD5/KTD6).
    const endSub = player.addListener("playToEnd", () => {
      recorderRef.current?.flush("end")
    })
    return () => endSub.remove()
  }, [player])

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") {
        qoeRef.current?.onError(error?.message)
      } else if (
        status === "loading" &&
        shouldCountRebuffer(hasStartedRef.current, isSwappingRef.current)
      ) {
        qoeRef.current?.onRebuffer()
      }
    })
    return () => sub.remove()
  }, [player])

  // R39 playhead watchdog: while playing and NOT buffering (a real rebuffer
  // flips status to 'loading', excluded), a frozen currentTime past the
  // threshold is the stuck-at-0:00 bug. Emit once, re-arm on recovery.
  const lastPollPositionRef = useRef(0)
  const lastAdvanceAtRef = useRef(0)
  const stallEmittedRef = useRef(false)
  useEffect(() => {
    // Poll only while playing (matches the comment above): the player ref is
    // stable for the whole mount, so keying on it alone would poll native every
    // 1s even while paused. Re-arms the stall window on each resume.
    if (!isPlaying) return
    lastAdvanceAtRef.current = Date.now()
    const id = setInterval(() => {
      let position: number
      let status: string
      let duration: number
      try {
        position = player.currentTime
        status = player.status
        duration = player.duration
      } catch {
        return // Native player already released
      }
      // Same poll feeds watched_ms, so no native timeUpdate event is needed.
      qoeRef.current?.onTimeUpdate(position)
      // The recorder samples this same 1s signal at 2s granularity (KTD5).
      recorderRef.current?.onTick(position, duration)
      onProgressRef.current?.(position, duration)

      const now = Date.now()
      const advanced =
        position - lastPollPositionRef.current > POSITION_EPSILON_S
      lastPollPositionRef.current = position
      if (advanced || status === "loading" || !isPlayingRef.current) {
        lastAdvanceAtRef.current = now
        stallEmittedRef.current = false
        return
      }
      if (
        !stallEmittedRef.current &&
        now - lastAdvanceAtRef.current >= STALL_THRESHOLD_MS
      ) {
        stallEmittedRef.current = true
        datadogLog.warn("video.playhead_stall", {
          content_id: sessionContentIdRef.current,
          playback_source: sessionSourceRef.current,
        })
      }
    }, STALL_POLL_MS)
    return () => clearInterval(id)
  }, [player, isPlaying])

  // R36: emit the QoE summary on session end. Distinct from the pause try/catch
  // above — that catch is unmount noise and stays silent (KTD4).
  useEffect(() => {
    return () => emitQoeSummary("abandoned")
  }, [emitQoeSummary])

  return { player, isPlaying, endSession }
}
