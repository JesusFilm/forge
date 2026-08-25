import { useCallback, useEffect, useRef } from "react"
import { AppState } from "react-native"
import { useEvent } from "expo"
import { useVideoPlayer, type VideoPlayer } from "expo-video"

import { extractMuxPlaybackId, isSameMuxAsset } from "../lib/muxThumbnail"
import { sameQualityConstraint } from "../lib/streamQuality"
import { datadogLog } from "../lib/datadog"
import { getMiniPlayerStore } from "../lib/miniPlayer/store"
import { appStateBranchDecision } from "../lib/pipPolicy"
import {
  createProgressRecorder,
  type FlushTrigger,
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

// Playhead watchdog (R39): poll currentTime while the player reports playing and
// is NOT buffering; if it stays frozen this long, emit one stall. 3s (not sub-1s)
// keeps normal ≤1s hitches out — the target is the black-frame/stuck-at-0:00 freeze.
const STALL_POLL_MS = 1000
const STALL_THRESHOLD_MS = 3000
// Float jitter: an advance under this counts as "not moving".
const POSITION_EPSILON_S = 0.25

// The two explicit endings that also force a progress write (KTD13). "ended"
// and "failed" close the quality session only — playToEnd already flushed —
// and "abandoned" is teardown, which keeps its own "unmount" trigger.
const FLUSH_TRIGGER_BY_END_REASON: Partial<
  Record<VideoQoeReason, FlushTrigger>
> = {
  dismissed: "dismiss",
  replaced: "replace",
}

/** KTD6: the hook's ref-stable progress facade. Cast-side callers drive the
 *  recorder through it without ever holding a recorder instance. */
export type ProgressFeed = {
  onTick: (positionSeconds: number, durationSeconds: number) => void
  flush: (trigger: FlushTrigger) => void
}

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
    /**
     * Only the root playback host owns the mini-player session. The session's
     * end event carries no adapter identity, so a second adapter (the two
     * `[sectionKey]` screens) would flush ITS recorder and close ITS quality
     * session on someone else's ending.
     */
    ownsSession?: boolean
    /**
     * The player now verifiably HOLDS this url — fired after a swap applies,
     * never when one is merely requested. A live `player.playing` read is only
     * evidence about the applied source; mid-swap it still describes the
     * outgoing video (AE10's admission hazard).
     */
    onSourceApplied?: (url: string) => void
    /** KTD4: true while a cast session drives playback. The AppState pair,
     *  the local recorder tick and the stall watchdog are suppressed; the
     *  background flush and the QoE time read stay on. */
    castActive?: boolean
  },
) {
  const ownsSession = options?.ownsSession === true
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

  const onSourceAppliedRef = useRef(options?.onSourceApplied)
  onSourceAppliedRef.current = options?.onSourceApplied
  // The creation source is applied by construction — the player was made
  // holding it. Swaps report their own apply below, on settle.
  useEffect(() => {
    if (creationSource != null) onSourceAppliedRef.current?.(creationSource)
  }, [creationSource])

  // Ref-mirrored (KTD4): the AppState effect registers once per player, so a
  // plain option in its closure would be stale by the time a session starts.
  const castActiveRef = useRef(options?.castActive === true)
  castActiveRef.current = options?.castActive === true

  // Whether the app is foregrounded right now. A swap's replaceAsync can outlive
  // a background transition; resume() reads this so it never force-plays into
  // the background after the AppState listener already paused.
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
      // Re-key (episode swap) or unmount: record the departing position.
      recorderRef.current?.flush("unmount")
      recorderRef.current = null
    }
  }, [recorderKey])

  /**
   * The explicit session ending (KTD13/R16/R17). Attribution no longer rides
   * React teardown: the caller names WHY the session ended, and this maps that
   * onto a forced progress write plus the quality-session close.
   *
   * The teardown cleanups stay as safety nets. They cannot steal the reason —
   * `emitQoeSummary` nulls the session it finalizes, so the first reason wins.
   */
  const endSession = useCallback(
    (reason: VideoQoeReason) => {
      const trigger = FLUSH_TRIGGER_BY_END_REASON[reason]
      if (trigger) recorderRef.current?.flush(trigger)
      emitQoeSummary(reason)
    },
    [emitQoeSummary],
  )

  // The session store is the one place that knows an ending and its reason, so
  // no call site has to remember to stop the previous video. With no session
  // open it reports nothing, which is every surface until the window ships.
  useEffect(() => {
    if (!ownsSession) return
    return getMiniPlayerStore().onEnd((event) => endSession(event.reason))
  }, [endSession, ownsSession])

  // KTD6: ref-stable facade — dereferences the CURRENT recorder at call
  // time, so a dub switch's rebuild cannot strand cast-side writes in the
  // flushed, dead instance.
  const progressFeed = useRef<ProgressFeed>({
    onTick: (positionSeconds, durationSeconds) =>
      recorderRef.current?.onTick(positionSeconds, durationSeconds),
    flush: (trigger) => recorderRef.current?.flush(trigger),
  }).current

  useEffect(() => {
    if (!sourceUrl || sourceUrl === loadedUrlRef.current) return

    // Compare by Mux playback ID, not raw URL: two URL strings can name one
    // asset (seed URL vs resolved variant); reloading it would needlessly
    // restart playback.
    const previousUrl = loadedUrlRef.current
    const sameAsset = isSameMuxAsset(previousUrl, sourceUrl)
    // KTD2: one asset under a NEW quality constraint must still reload — the
    // tier rides the URL, so coalescing here would silently drop the pick.
    const constraintSwap =
      sameAsset &&
      previousUrl != null &&
      !sameQualityConstraint(previousUrl, sourceUrl)
    loadedUrlRef.current = sourceUrl
    if (sameAsset && !constraintSwap) {
      // Same asset behind a new string: the player already holds it.
      onSourceAppliedRef.current?.(sourceUrl)
      return
    }
    // Swap-log content id (the QoE session id below tracks it separately).
    const nextId = extractMuxPlaybackId(sourceUrl)

    // A genuine cross-asset swap ends this QoE session and opens a new one so
    // watched_ms/rebuffers/source attribute to the right asset (R36/R38). A
    // constraint swap is the SAME asset, so its session continues (R14).
    if (!constraintSwap) {
      endSession("abandoned")
      startQoeSession(sourceUrl)
    }
    isSwappingRef.current = true

    // Preserve playback across a cross-asset swap: replace() drops the playing
    // state. A constraint swap suppresses this — the host's sourceLoad latch
    // owns resume there (seek first), so a play here would restart at zero.
    const wasPlaying = !constraintSwap && player.playing
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
      .then(() => {
        onSourceAppliedRef.current?.(sourceUrl)
        resume()
      })
      .catch(() => {
        datadogLog.warn("video.swap_fallback", { content_id: nextId })
        try {
          player.replace(sourceUrl, true)
          onSourceAppliedRef.current?.(sourceUrl)
          resume()
        } catch {
          datadogLog.error("video.swap_failed", { content_id: nextId })
        }
      })
      .finally(() => {
        isSwappingRef.current = false
      })
  }, [sourceUrl, player, endSession, startQoeSession])

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
  // app left — never starts a video the user had paused or never played. What
  // each state decides is U4's table (R13): picture-in-picture keeps playing.
  const wasPlayingRef = useRef(false)
  // Set when the app left with the picture-in-picture hold on. Nothing paused
  // the video then, so `wasPlayingRef` holds a stale snapshot from an earlier
  // background and would force-resume a video paused inside the window.
  const leftUnderPipRef = useRef(false)
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const pipActive = getMiniPlayerStore().getSnapshot().pipHold
      const decision = appStateBranchDecision(nextState, pipActive)

      if (nextState === "active") {
        isForegroundRef.current = true
        const resumeFromPip = leftUnderPipRef.current
        leftUnderPipRef.current = false
        let shouldResume = wasPlayingRef.current
        if (resumeFromPip) {
          try {
            shouldResume = player.playing
          } catch {
            shouldResume = false // Already released
          }
        }
        // A session on the TV owns playback: neither resume source may start
        // local audio over it (KTD4).
        if (shouldResume && !castActiveRef.current) {
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

      if (decision.flushProgress) {
        // A real departure. `inactive` decides nothing under U4's table, so a
        // call or the app switcher leaves the swap-resume guard armed.
        isForegroundRef.current = false
        leftUnderPipRef.current = pipActive
        recorderRef.current?.flush("background")
      }
      if (decision.recordWasPlaying) {
        wasPlayingRef.current = isPlayingRef.current
      }
      // KTD4: a session took the player over, so any snapshot is stale — and
      // the local pause may not have landed in playingChange yet. Cleared on
      // every departure, so a session ending while away resumes nothing.
      if (castActiveRef.current) wasPlayingRef.current = false
      // R13 keeps the operating system's window playing; a session owns
      // transport. Two independent vetoes over one pause.
      if (decision.pause && !castActiveRef.current) {
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
    // Playback end records the completed range (KTD5/KTD6). Gated: while a
    // session owns playback, the frozen local player must not mark the
    // video completed — the receiver's finished status owns that flush.
    const endSub = player.addListener("playToEnd", () => {
      if (!castActiveRef.current) recorderRef.current?.flush("end")
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
      // Under a cast session the feed owns the recorder — skipping the local
      // tick makes double-write prevention structural (KTD6).
      if (!castActiveRef.current) {
        recorderRef.current?.onTick(position, duration)
      }
      // The floating window reads its scrubber from the same tick (KTD2), and
      // the store drops it when no session is open. Owner-gated for the same
      // reason as the end subscription above.
      if (ownsSession)
        getMiniPlayerStore().publishPosition({
          positionSeconds: position,
          durationSeconds: duration,
        })

      const now = Date.now()
      // KTD4: a frozen local playhead is expected while the chrome drives the
      // TV — keep the watchdog disarmed and clean so it re-arms on return.
      if (castActiveRef.current) {
        lastAdvanceAtRef.current = now
        stallEmittedRef.current = false
        return
      }
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
  }, [player, isPlaying, ownsSession])

  // R36: emit the QoE summary on session end. Distinct from the pause try/catch
  // above — that catch is unmount noise and stays silent (KTD4).
  useEffect(() => {
    return () => emitQoeSummary("abandoned")
  }, [emitQoeSummary])

  return { player, isPlaying, progressFeed }
}
