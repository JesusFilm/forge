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
  enqueueOfflineWrite,
  getProgressSync,
  getSignedInAccountId,
} from "../lib/watchProgress/syncClient"
import {
  createVideoQoeSession,
  shouldCountRebuffer,
  type VideoQoeReason,
  type VideoQoeSession,
} from "../lib/videoQoe"

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
  options?: { progress?: ProgressIdentity | null },
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
  // a background transition; resume() reads this so it never force-plays into
  // the background after the AppState listener already paused.
  const isForegroundRef = useRef(true)

  // ── Playback QoE session (R36/R38) ──────────────────────────────────
  // Pure accumulator (createVideoQoeSession) fed from the listeners below; the
  // summary emits once on session end (unmount / cross-asset swap). content_id
  // is the Mux playback id (PII-free); source is offline vs network per R38.
  const qoeRef = useRef<VideoQoeSession | null>(null)
  const sessionContentIdRef = useRef<string | null>(null)
  const sessionSourceRef = useRef<"offline" | "network">("network")
  const sessionStartedRef = useRef(false)
  // Rebuffer gate: has playback begun, and is a source swap mid-flight.
  const hasStartedRef = useRef(false)
  const isSwappingRef = useRef(false)

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
      source: sessionSourceRef.current,
    })
  }, [])

  const startQoeSession = useCallback((url: string | null) => {
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

  // ── Progress recorder (KTD5) ─────────────────────────────────────────
  // One recorder per identity; an identity change (episode swap in the
  // collection pager) flushes the departing video before re-keying. Offline
  // (file://) playback routes writes to the account-bound queue.
  const progressIdentity = options?.progress ?? null
  const recorderRef = useRef<ProgressRecorder | null>(null)
  const recorderKey = progressIdentity
    ? `${progressIdentity.videoId ?? ""}|${progressIdentity.videoSlug ?? ""}`
    : null
  const identityRef = useRef(progressIdentity)
  identityRef.current = progressIdentity
  // Effect, not render: flush() buffers an intent and dispatches a network
  // drain, so the departing video's write must not fire mid-render.
  useEffect(() => {
    const identity = identityRef.current
    recorderRef.current = identity
      ? createProgressRecorder(identity, sessionSourceRef.current, {
          getAccountId: getSignedInAccountId,
          bufferIntent: bufferProgressIntent,
          enqueueOffline: enqueueOfflineWrite,
          requestDrain: (drainOptions) =>
            void getProgressSync().drainIntents(drainOptions),
          applyLocal: applyLocalProgress,
          onSignedOutStop: noteSignedOutPlaybackStop,
        })
      : null
    return () => {
      // Re-key (episode swap) or unmount: record the departing position.
      recorderRef.current?.flush("unmount")
      recorderRef.current = null
    }
  }, [recorderKey])

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
    emitQoeSummary("abandoned")
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
      } else {
        isForegroundRef.current = false
        wasPlayingRef.current = isPlayingRef.current
        recorderRef.current?.flush("background")
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
          source: sessionSourceRef.current,
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

  return { player, isPlaying }
}
