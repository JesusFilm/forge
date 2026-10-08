"use client"

import { useEffect, useRef, type RefObject } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import {
  recordMeaningfulWatchEvent,
  type RecordMeaningfulWatchEventInput,
} from "@/lib/watch-event-actions"
import { getViewerId } from "@/lib/viewer-id"
import { reportGoogleAnalyticsEvent } from "@/components/GoogleAnalytics"
import {
  type WatchAnalyticsEventInput,
  type WatchAnalyticsMilestonePercent,
  WATCH_ANALYTICS_MILESTONE_PERCENTS,
  dispatchWatchAnalyticsEvent,
  isWatchAnalyticsContractV2Enabled,
} from "@/lib/watch-analytics-contract"

const QUEUE_STORAGE_KEY = "forge.watch.pending_events"
const MAX_QUEUED_EVENTS = 8
const MEANINGFUL_SECONDS = 30
const MEANINGFUL_PROGRESS = 0.25
const PLAYBACK_PROGRESS_MILESTONES = WATCH_ANALYTICS_MILESTONE_PERCENTS

export type WatchEventRecorderProps = {
  playerRef: RefObject<MuxPlayerRef | null>
  videoId: string
  videoDubId: string
  durationSeconds?: number | null
}

type QueuedWatchEvent = RecordMeaningfulWatchEventInput & {
  queuedAt: string
}

function readQueue(): QueuedWatchEvent[] {
  if (typeof window === "undefined") return []

  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_QUEUED_EVENTS) : []
  } catch {
    return []
  }
}

function writeQueue(events: QueuedWatchEvent[]): void {
  if (typeof window === "undefined") return

  try {
    if (events.length === 0) {
      window.localStorage.removeItem(QUEUE_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify(events.slice(-MAX_QUEUED_EVENTS)),
    )
  } catch {
    // Local storage is best-effort only.
  }
}

function queueEvent(input: RecordMeaningfulWatchEventInput): void {
  const queued: QueuedWatchEvent = {
    ...input,
    queuedAt: new Date().toISOString(),
  }
  writeQueue([...readQueue(), queued])
}

function getMediaDuration(
  player: MuxPlayerRef | null,
  fallback: number | null | undefined,
): number | null {
  const duration =
    typeof player?.duration === "number" && Number.isFinite(player.duration)
      ? player.duration
      : fallback
  return typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0
    ? duration
    : null
}

function buildEventInput({
  player,
  requestSessionId,
  videoDubId,
  videoId,
  durationSeconds,
}: {
  player: MuxPlayerRef | null
  requestSessionId: string
  videoDubId: string
  videoId: string
  durationSeconds?: number | null
}): RecordMeaningfulWatchEventInput {
  const duration = getMediaDuration(player, durationSeconds)
  const position =
    typeof player?.currentTime === "number" &&
    Number.isFinite(player.currentTime)
      ? player.currentTime
      : null

  return {
    videoId,
    videoDubId,
    positionSeconds: position,
    durationSeconds: duration,
    progress: duration != null && position != null ? position / duration : null,
    requestSessionId,
  }
}

type PlaybackSnapshot = {
  durationSeconds: number | null
  positionSeconds: number | null
}

function readPlaybackSnapshot(
  player: MuxPlayerRef | null,
  fallbackDuration: number | null | undefined,
): PlaybackSnapshot {
  return {
    durationSeconds: getMediaDuration(player, fallbackDuration),
    positionSeconds:
      typeof player?.currentTime === "number" &&
      Number.isFinite(player.currentTime)
        ? player.currentTime
        : null,
  }
}

function snapshotProgressPercent({
  durationSeconds,
  positionSeconds,
}: PlaybackSnapshot): number | null {
  return durationSeconds != null && positionSeconds != null
    ? Math.min(
        100,
        Math.max(0, Math.round((positionSeconds / durationSeconds) * 100)),
      )
    : null
}

/** v1 wire parameters, unchanged since the characterization in U1. */
function playbackAnalyticsParams({
  snapshot,
  videoDubId,
  videoId,
  progressPercent,
}: {
  snapshot: PlaybackSnapshot
  videoDubId: string
  videoId: string
  progressPercent?: number | null
}) {
  const { durationSeconds, positionSeconds } = snapshot
  return {
    duration_seconds:
      durationSeconds != null ? Math.round(durationSeconds) : null,
    position_seconds:
      positionSeconds != null ? Math.round(positionSeconds) : null,
    progress_percent: progressPercent ?? snapshotProgressPercent(snapshot),
    video_dub_id: videoDubId,
    video_id: videoId,
  }
}

/**
 * Whether a `pause` is the browser's terminal pause. Media elements fire
 * `pause` immediately before `ended` when playback reaches the end, with
 * `ended` already true. v2 reports that moment once, as `videocomplete`,
 * instead of also recording an analytical pause the viewer never made.
 */
function isTerminalPause(player: MuxPlayerRef): boolean {
  return (player as { ended?: unknown }).ended === true
}

async function submitOrQueue(
  input: RecordMeaningfulWatchEventInput,
): Promise<void> {
  const result = await recordMeaningfulWatchEvent(input)
  if (
    result.ok &&
    result.recorded === false &&
    result.reason === "signed-out"
  ) {
    queueEvent(input)
  }
}

async function flushQueue(): Promise<void> {
  const queued = readQueue()
  if (queued.length === 0) return

  const remaining: QueuedWatchEvent[] = []
  for (const event of queued) {
    const result = await recordMeaningfulWatchEvent({
      videoId: event.videoId,
      videoDubId: event.videoDubId,
      languageId: event.languageId,
      positionSeconds: event.positionSeconds,
      durationSeconds: event.durationSeconds,
      progress: event.progress,
      requestSessionId: event.requestSessionId,
    })
    if (result.ok && result.recorded) continue
    remaining.push(event)
  }
  writeQueue(remaining)
}

export function WatchEventRecorder({
  playerRef,
  videoId,
  videoDubId,
  durationSeconds,
}: WatchEventRecorderProps) {
  // Every guard below is scoped to the (videoId, videoDubId) playback
  // identity: the identity effect resets them on a video or dub swap, and a
  // rerender with the same identity leaves them alone (R12).
  const recordedRef = useRef(false)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  // Index of the next milestone not yet reported. Milestones are ascending,
  // so one integer is equivalent to a reported-set and lets the `timeupdate`
  // non-firing path return after a single comparison (R28).
  const nextMilestoneIndexRef = useRef(0)

  useEffect(() => {
    void flushQueue()
  }, [])

  useEffect(() => {
    recordedRef.current = false
    startedRef.current = false
    completedRef.current = false
    nextMilestoneIndexRef.current = 0
  }, [videoDubId, videoId])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    // KTD6: the build-time flag selects ONE path for every player event, so
    // a v1 and a v2 emission of the same transition can never both run.
    const contractV2 = isWatchAnalyticsContractV2Enabled()
    const requestSessionId = getViewerId()
    const snapshot = () => readPlaybackSnapshot(player, durationSeconds)
    const v1Params = (current: PlaybackSnapshot, progressPercent?: number) =>
      playbackAnalyticsParams({
        snapshot: current,
        videoDubId,
        videoId,
        progressPercent,
      })
    // Player events are never followed by a document replacement, so they
    // yield to paint; a backgrounded tab is covered by the seam's
    // visibilitychange/pagehide flush (R28, KTD9).
    const dispatch = (input: WatchAnalyticsEventInput) =>
      dispatchWatchAnalyticsEvent(input, { mode: "deferred" })

    const reportPlaybackStarted = () => {
      const current = snapshot()
      if (contractV2) {
        dispatch({
          type: "player_play",
          durationSeconds: current.durationSeconds ?? undefined,
          positionSeconds: current.positionSeconds ?? undefined,
        })
      } else {
        reportGoogleAnalyticsEvent("videoplay", v1Params(current))
      }
      if (startedRef.current) return
      startedRef.current = true
      if (contractV2) {
        dispatch({
          type: "player_started",
          durationSeconds: current.durationSeconds ?? undefined,
          positionSeconds: 0,
          contentId: videoId,
          dubId: videoDubId,
        })
      } else {
        reportGoogleAnalyticsEvent("videostarts", v1Params(current, 0))
      }
    }
    const reportMilestone = (milestone: WatchAnalyticsMilestonePercent) => {
      const current = snapshot()
      if (contractV2) {
        dispatch({
          type: "player_milestone",
          milestonePercent: milestone,
          durationSeconds: current.durationSeconds ?? undefined,
          positionSeconds: current.positionSeconds ?? undefined,
        })
      } else {
        reportGoogleAnalyticsEvent(
          `a_media_progress${milestone}`,
          v1Params(current, milestone),
        )
      }
    }
    const evaluate = () => {
      const duration = getMediaDuration(player, durationSeconds)
      const currentTime =
        typeof player.currentTime === "number" &&
        Number.isFinite(player.currentTime)
          ? player.currentTime
          : 0
      const progress = duration != null ? currentTime / duration : 0
      const progressPercent = Math.round(progress * 100)
      // A seek across several milestones reports each crossed one, in order,
      // exactly once; seeking back and replaying cannot re-arm them.
      while (
        nextMilestoneIndexRef.current < PLAYBACK_PROGRESS_MILESTONES.length &&
        progressPercent >=
          PLAYBACK_PROGRESS_MILESTONES[nextMilestoneIndexRef.current]
      ) {
        const milestone =
          PLAYBACK_PROGRESS_MILESTONES[nextMilestoneIndexRef.current]
        nextMilestoneIndexRef.current += 1
        reportMilestone(milestone)
      }
      if (recordedRef.current) return
      const meaningful =
        currentTime >= MEANINGFUL_SECONDS || progress >= MEANINGFUL_PROGRESS
      if (!meaningful) return

      recordedRef.current = true
      const current = snapshot()
      if (contractV2) {
        dispatch({
          type: "player_meaningful_progress",
          durationSeconds: current.durationSeconds ?? undefined,
          positionSeconds: current.positionSeconds ?? undefined,
          progressPercent: snapshotProgressPercent(current) ?? undefined,
        })
      } else {
        reportGoogleAnalyticsEvent("video_progress", v1Params(current))
      }
      void submitOrQueue(
        buildEventInput({
          player,
          requestSessionId,
          videoDubId,
          videoId,
          durationSeconds,
        }),
      )
    }
    const reportPlaybackPaused = () => {
      const current = snapshot()
      if (!contractV2) {
        reportGoogleAnalyticsEvent("video_pause", v1Params(current))
        return
      }
      if (isTerminalPause(player)) return
      dispatch({
        type: "player_pause",
        durationSeconds: current.durationSeconds ?? undefined,
        positionSeconds: current.positionSeconds ?? undefined,
        progressPercent: snapshotProgressPercent(current) ?? undefined,
      })
    }
    const complete = () => {
      if (completedRef.current) return
      completedRef.current = true
      const current = snapshot()
      if (contractV2) {
        dispatch({
          type: "player_completed",
          durationSeconds: current.durationSeconds ?? undefined,
          progressPercent: 100,
        })
      } else {
        reportGoogleAnalyticsEvent("videocomplete", v1Params(current, 100))
      }
      evaluate()
    }

    player.addEventListener("play", reportPlaybackStarted)
    player.addEventListener("pause", reportPlaybackPaused)
    player.addEventListener("timeupdate", evaluate)
    player.addEventListener("ended", complete)

    return () => {
      player.removeEventListener("play", reportPlaybackStarted)
      player.removeEventListener("pause", reportPlaybackPaused)
      player.removeEventListener("timeupdate", evaluate)
      player.removeEventListener("ended", complete)
    }
  }, [durationSeconds, playerRef, videoDubId, videoId])

  return null
}
