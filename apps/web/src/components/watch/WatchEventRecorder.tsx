"use client"

import { useEffect, useRef, type RefObject } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import {
  recordMeaningfulWatchEvent,
  type RecordMeaningfulWatchEventInput,
} from "@/lib/watch-event-actions"
import { getViewerId } from "@/lib/viewer-id"
import { reportGoogleAnalyticsEvent } from "@/components/GoogleAnalytics"

const QUEUE_STORAGE_KEY = "forge.watch.pending_events"
const MAX_QUEUED_EVENTS = 8
const MEANINGFUL_SECONDS = 30
const MEANINGFUL_PROGRESS = 0.25
const PLAYBACK_PROGRESS_MILESTONES = [10, 25, 50, 75, 90] as const

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

function playbackAnalyticsParams({
  player,
  videoDubId,
  videoId,
  durationSeconds,
  progressPercent,
}: {
  player: MuxPlayerRef | null
  videoDubId: string
  videoId: string
  durationSeconds?: number | null
  progressPercent?: number | null
}) {
  const duration = getMediaDuration(player, durationSeconds)
  const position =
    typeof player?.currentTime === "number" &&
    Number.isFinite(player.currentTime)
      ? player.currentTime
      : null

  return {
    duration_seconds: duration != null ? Math.round(duration) : null,
    position_seconds: position != null ? Math.round(position) : null,
    progress_percent:
      progressPercent ??
      (duration != null && position != null
        ? Math.min(100, Math.max(0, Math.round((position / duration) * 100)))
        : null),
    video_dub_id: videoDubId,
    video_id: videoId,
  }
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
  const recordedRef = useRef(false)
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const reportedMilestonesRef = useRef(new Set<number>())

  useEffect(() => {
    void flushQueue()
  }, [])

  useEffect(() => {
    recordedRef.current = false
    startedRef.current = false
    completedRef.current = false
    reportedMilestonesRef.current = new Set()
  }, [videoDubId, videoId])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const requestSessionId = getViewerId()
    const reportPlaybackStarted = () => {
      reportGoogleAnalyticsEvent(
        "videoplay",
        playbackAnalyticsParams({
          player,
          videoDubId,
          videoId,
          durationSeconds,
        }),
      )
      if (startedRef.current) return
      startedRef.current = true
      reportGoogleAnalyticsEvent(
        "videostarts",
        playbackAnalyticsParams({
          player,
          videoDubId,
          videoId,
          durationSeconds,
          progressPercent: 0,
        }),
      )
    }
    const reportPlaybackMilestones = (progressPercent: number) => {
      for (const milestone of PLAYBACK_PROGRESS_MILESTONES) {
        if (progressPercent < milestone) continue
        if (reportedMilestonesRef.current.has(milestone)) continue
        reportedMilestonesRef.current.add(milestone)
        reportGoogleAnalyticsEvent(
          `a_media_progress${milestone}`,
          playbackAnalyticsParams({
            player,
            videoDubId,
            videoId,
            durationSeconds,
            progressPercent: milestone,
          }),
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
      reportPlaybackMilestones(Math.round(progress * 100))
      const meaningful =
        currentTime >= MEANINGFUL_SECONDS || progress >= MEANINGFUL_PROGRESS
      if (recordedRef.current) return
      if (!meaningful) return

      recordedRef.current = true
      reportGoogleAnalyticsEvent(
        "video_progress",
        playbackAnalyticsParams({
          player,
          videoDubId,
          videoId,
          durationSeconds,
        }),
      )
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
      reportGoogleAnalyticsEvent(
        "video_pause",
        playbackAnalyticsParams({
          player,
          videoDubId,
          videoId,
          durationSeconds,
        }),
      )
    }
    const complete = () => {
      if (completedRef.current) return
      completedRef.current = true
      reportGoogleAnalyticsEvent(
        "videocomplete",
        playbackAnalyticsParams({
          player,
          videoDubId,
          videoId,
          durationSeconds,
          progressPercent: 100,
        }),
      )
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
