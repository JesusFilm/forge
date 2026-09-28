/**
 * Explore telemetry (KTD17, R34): product signals are RUM actions whose keys
 * start with `explore_`; operational and playback-health events use the log
 * sink. React-free: the feed and the watch page call it.
 */

import { datadogLog, reportDatadogAction } from "../datadog"
import { sanitizeVideoErrorMessage, type VideoQoeReason } from "../videoQoe"
import { randomUUIDCompat } from "../viewer-id"
import { daysBetweenDateKeys, getClipRecordStore } from "./clipRecord"
import type { TravelDirection } from "./feedState"
import type { PlayerMode } from "./playerMode"
import type { ClipTier } from "./types"
import { watchIntentKey, type WatchIntent } from "./watchIntent"

/** KTD17: a visit ends after this long away from Explore, or on relaunch. */
export const EXPLORE_VISIT_TIMEOUT_MS = 30 * 60 * 1000

/** KTD17: a clip counts as watched once it has played this long. */
export const EXPLORE_CLIP_WATCHED_SECONDS = 3

/** KTD6: a warm open takes its first clip from the stored pool. */
export type ExplorePoolState = "warm" | "cold"

/** First-motion stages after the pool; each is timed from the first focus. */
export type ExploreFirstMotionStage =
  | "clipQueued"
  | "sourceSet"
  | "sourceLoaded"

export type ExploreClipFailure = "sourceError" | "missedSeek" | "timeout"

/** The watch intent fields a full play needs. The `origin` type makes a caller
 *  filter out other origins if `WatchIntentOrigin` ever widens. */
export type ExploreFullPlayIntent = Pick<
  WatchIntent,
  "videoSlug" | "createdAt"
> & {
  origin: "explore"
}

/** The clip record calls the return check makes. */
export type ExploreClipRecordPort = {
  hydrate: () => Promise<void>
  recordVisit: () => string | null
  getLastVisitDate: () => string | null
}

/** No error level: the native SDK copies an error log's whole attribute bag
 *  into a RUM error. */
export type ExploreTelemetrySink = {
  info: (event: string, context: Record<string, unknown>) => void
  warn: (event: string, context: Record<string, unknown>) => void
}

export type ExploreTelemetryDeps = {
  /** Both sinks keep these names on purpose: datadogReservedAttributes.guard
   *  finds emit sites by spelling, so a rename hides every call below. */
  reportDatadogAction: (name: string, context: Record<string, unknown>) => void
  telemetry: ExploreTelemetrySink
  clipRecord: ExploreClipRecordPort
  now?: () => number
  createId?: () => string
}

export type ExploreTelemetry = {
  /**
   * Explore gained focus, from a tab switch or the foreground. `playerMode`
   * applies at the launch's first focus only, as in the feed reducer.
   */
  focus: (playerMode: PlayerMode) => void
  /** A tab switch, "Keep watching", or the background. */
  blur: () => void
  /**
   * The current showing's played seconds (position minus the window start).
   * `clipKey` names one history entry, so a replay or a reload counts once.
   */
  clipProgress: (clipKey: string, playedSeconds: number) => void
  keepWatchingTap: (videoSlug: string) => void
  /** First-motion stage: the pool is ready, stored (warm) or fetched (cold). */
  poolReady: (poolState: ExplorePoolState) => void
  firstMotionStage: (stage: ExploreFirstMotionStage) => void
  /** Motion is confirmed on a new source in the active player (KTD2). */
  motionConfirmed: () => void
  /** A committed swipe. `preloadHit`: the destination clip was already loaded. */
  swipe: (input: { preloadHit: boolean; direction: TravelDirection }) => void
  rebuffer: () => void
  clipFailed: (input: {
    failure: ExploreClipFailure
    slot: "active" | "standby"
    videoId: string
    feedLanguageSlug: string
    errorMessage: string | null
  }) => void
  demoted: (standbyErrors: number) => void
  /** The queue took a clip from a lower tier, or released record entries. */
  poolFallback: (input: {
    tier: ClipTier
    feedLanguageSlug: string
    releasedEntries: number
  }) => void
  /** The watch page's first frame. True only when a new full play starts. */
  fullPlayStart: (intent: ExploreFullPlayIntent) => boolean
  fullPlayPlaying: (isPlaying: boolean) => void
  /** The watch session ended. Only the first end of a full play counts. */
  fullPlayEnd: (reason: VideoQoeReason) => void
}

type Visit = {
  id: string
  focusedMs: number
  watchedClips: Set<string>
  keepWatchingTaps: number
  rebuffers: number
}

type FirstMotion = {
  focusedAt: number
  poolState: ExplorePoolState | null
  /** Milliseconds from the first focus to each stage. */
  poolReady: number | null
  clipQueued: number | null
  sourceSet: number | null
  sourceLoaded: number | null
}

type PendingSwipe = {
  at: number
  preloadHit: boolean
  direction: TravelDirection
  playerMode: PlayerMode
}

type FullPlay = {
  videoSlug: string
  visitId: string | null
  playedMs: number
  playingSince: number | null
}

export function createExploreTelemetry(
  deps: ExploreTelemetryDeps,
): ExploreTelemetry {
  const now = deps.now ?? (() => Date.now())
  const createId = deps.createId ?? randomUUIDCompat

  let playerMode: PlayerMode = "two"
  let demotedThisLaunch = false
  let firstFocusSeen = false
  let visit: Visit | null = null
  let focusedSince: number | null = null
  let awaySince: number | null = null
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let firstMotion: FirstMotion | null = null
  let pendingSwipe: PendingSwipe | null = null
  let fullPlay: FullPlay | null = null
  let lastFullPlayKey: string | null = null

  const visitId = (): string | null => visit?.id ?? null

  function clearEndTimer(): void {
    if (endTimer != null) clearTimeout(endTimer)
    endTimer = null
  }

  function endVisit(): void {
    clearEndTimer()
    awaySince = null
    const ended = visit
    if (ended == null) return
    visit = null
    deps.reportDatadogAction("explore.visit_end", {
      explore_visit_id: ended.id,
      explore_clips_watched: ended.watchedClips.size,
      explore_keep_watching_taps: ended.keepWatchingTaps,
      explore_visit_focused_ms: ended.focusedMs,
    })
  }

  /** The stored date must land first, or today's date replaces it. */
  async function reportReturn(id: string): Promise<void> {
    await deps.clipRecord.hydrate()
    const previous = deps.clipRecord.recordVisit()
    const today = deps.clipRecord.getLastVisitDate()
    if (previous == null || today == null) return
    const days = daysBetweenDateKeys(previous, today)
    if (days == null || days < 1) return
    deps.reportDatadogAction("explore.return", {
      explore_visit_id: id,
      explore_days_since_last_visit: days,
    })
  }

  function startVisit(): void {
    const id = createId()
    visit = {
      id,
      focusedMs: 0,
      watchedClips: new Set(),
      keepWatchingTaps: 0,
      rebuffers: 0,
    }
    deps.reportDatadogAction("explore.visit_start", { explore_visit_id: id })
    reportReturn(id).catch(() => {})
  }

  function closeFirstMotion(outcome: "motion" | "left" | "swiped"): void {
    const pending = firstMotion
    if (pending == null) return
    firstMotion = null
    deps.telemetry.info("explore.first_motion", {
      explore_visit_id: visitId(),
      explore_first_motion_outcome: outcome,
      explore_first_motion_ms:
        outcome === "motion" ? now() - pending.focusedAt : null,
      explore_pool_ready_ms: pending.poolReady,
      explore_clip_queued_ms: pending.clipQueued,
      explore_source_set_ms: pending.sourceSet,
      explore_source_loaded_ms: pending.sourceLoaded,
      explore_pool_state: pending.poolState,
      explore_player_mode: playerMode,
    })
  }

  function closeSwipe(outcome: "motion" | "superseded" | "left"): void {
    const pending = pendingSwipe
    if (pending == null) return
    pendingSwipe = null
    deps.telemetry.info("explore.swipe", {
      explore_visit_id: visitId(),
      explore_preload_hit: pending.preloadHit,
      explore_swipe_direction: pending.direction,
      explore_swipe_outcome: outcome,
      explore_swipe_to_motion_ms:
        outcome === "motion" ? now() - pending.at : null,
      explore_player_mode: pending.playerMode,
    })
  }

  function endFullPlay(reason: VideoQoeReason): void {
    const ended = fullPlay
    if (ended == null) return
    fullPlay = null
    const playingMs =
      ended.playingSince == null ? 0 : now() - ended.playingSince
    deps.reportDatadogAction("explore.full_play_end", {
      explore_visit_id: ended.visitId,
      explore_video_slug: ended.videoSlug,
      explore_full_play_ms: ended.playedMs + playingMs,
      explore_end_reason: reason,
    })
  }

  return {
    focus(mode) {
      if (focusedSince != null) return
      const at = now()
      if (!firstFocusSeen) {
        firstFocusSeen = true
        playerMode = mode
        firstMotion = {
          focusedAt: at,
          poolState: null,
          poolReady: null,
          clipQueued: null,
          sourceSet: null,
          sourceLoaded: null,
        }
      }
      // A suspended app runs no timer, so the focus checks the time away too.
      if (awaySince != null && at - awaySince >= EXPLORE_VISIT_TIMEOUT_MS) {
        endVisit()
      }
      clearEndTimer()
      awaySince = null
      if (visit == null) startVisit()
      focusedSince = at
    },

    blur() {
      if (focusedSince == null) return
      const at = now()
      if (visit != null) visit.focusedMs += at - focusedSince
      focusedSince = null
      closeFirstMotion("left")
      closeSwipe("left")
      if (visit == null) return
      awaySince = at
      clearEndTimer()
      endTimer = setTimeout(endVisit, EXPLORE_VISIT_TIMEOUT_MS)
    },

    clipProgress(clipKey, playedSeconds) {
      if (visit == null || !(playedSeconds >= EXPLORE_CLIP_WATCHED_SECONDS)) {
        return
      }
      if (visit.watchedClips.has(clipKey)) return
      visit.watchedClips.add(clipKey)
      // Sent per clip as well as at the visit end: a relaunch ends a visit
      // with no end action, and these per-clip actions still count it.
      deps.reportDatadogAction("explore.clip_watched", {
        explore_visit_id: visit.id,
        explore_clips_watched: visit.watchedClips.size,
      })
    },

    keepWatchingTap(videoSlug) {
      if (visit != null) visit.keepWatchingTaps += 1
      deps.reportDatadogAction("explore.keep_watching", {
        explore_visit_id: visitId(),
        explore_keep_watching_taps: visit?.keepWatchingTaps ?? null,
        explore_video_slug: videoSlug,
      })
    },

    poolReady(poolState) {
      if (firstMotion == null || firstMotion.poolReady != null) return
      firstMotion.poolReady = now() - firstMotion.focusedAt
      firstMotion.poolState = poolState
    },

    firstMotionStage(stage) {
      if (firstMotion == null || firstMotion[stage] != null) return
      firstMotion[stage] = now() - firstMotion.focusedAt
    },

    motionConfirmed() {
      if (firstMotion != null) {
        closeFirstMotion("motion")
        return
      }
      closeSwipe("motion")
    },

    swipe({ preloadHit, direction }) {
      closeFirstMotion("swiped")
      closeSwipe("superseded")
      pendingSwipe = { at: now(), preloadHit, direction, playerMode }
    },

    rebuffer() {
      if (visit != null) visit.rebuffers += 1
      deps.telemetry.info("explore.rebuffer", {
        explore_visit_id: visitId(),
        explore_visit_rebuffers: visit?.rebuffers ?? null,
        explore_player_mode: playerMode,
      })
    },

    clipFailed(input) {
      deps.telemetry.warn("explore.clip_failed", {
        explore_visit_id: visitId(),
        explore_failure: input.failure,
        explore_slot: input.slot,
        explore_video_id: input.videoId,
        explore_feed_language: input.feedLanguageSlug,
        explore_player_mode: playerMode,
        // A native message can carry the stream url and its query.
        explore_error_message:
          input.errorMessage == null || input.errorMessage === ""
            ? null
            : sanitizeVideoErrorMessage(input.errorMessage),
      })
    },

    demoted(standbyErrors) {
      playerMode = "one"
      if (demotedThisLaunch) return
      demotedThisLaunch = true
      deps.telemetry.warn("explore.demoted", {
        explore_visit_id: visitId(),
        explore_standby_errors: standbyErrors,
      })
    },

    poolFallback(input) {
      deps.telemetry.info("explore.pool_fallback", {
        explore_visit_id: visitId(),
        explore_clip_tier: input.tier,
        explore_feed_language: input.feedLanguageSlug,
        explore_released_entries: input.releasedEntries,
      })
    },

    fullPlayStart(intent) {
      // The only dedupe: a second render of one page starts nothing, and a
      // new hand-off ends the open full play.
      const key = watchIntentKey(intent)
      if (key === lastFullPlayKey) return false
      endFullPlay("replaced")
      lastFullPlayKey = key
      fullPlay = {
        videoSlug: intent.videoSlug,
        visitId: visitId(),
        playedMs: 0,
        playingSince: now(),
      }
      deps.reportDatadogAction("explore.full_play_start", {
        explore_visit_id: fullPlay.visitId,
        explore_video_slug: intent.videoSlug,
      })
      return true
    },

    fullPlayPlaying(isPlaying) {
      const open = fullPlay
      if (open == null) return
      if (isPlaying) {
        open.playingSince ??= now()
        return
      }
      if (open.playingSince == null) return
      open.playedMs += now() - open.playingSince
      open.playingSince = null
    },

    fullPlayEnd(reason) {
      endFullPlay(reason)
    },
  }
}

let appTelemetry: ExploreTelemetry | null = null

/** One instance per launch: a relaunch starts a new visit (KTD17). */
export function getExploreTelemetry(): ExploreTelemetry {
  appTelemetry ??= createExploreTelemetry({
    reportDatadogAction,
    telemetry: datadogLog,
    clipRecord: getClipRecordStore(),
  })
  return appTelemetry
}
