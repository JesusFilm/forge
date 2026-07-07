"use client"

import { useEffect, useRef, type RefObject } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import {
  recordMeaningfulWatchEvent,
  type RecordMeaningfulWatchEventInput,
} from "@/lib/watch-event-actions"
import { getViewerId } from "@/lib/viewer-id"

const QUEUE_STORAGE_KEY = "forge.watch.pending_events"
const MAX_QUEUED_EVENTS = 8
const MEANINGFUL_SECONDS = 30
const MEANINGFUL_PROGRESS = 0.25

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

  useEffect(() => {
    void flushQueue()
  }, [])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    const requestSessionId = getViewerId()
    const evaluate = () => {
      if (recordedRef.current) return
      const duration = getMediaDuration(player, durationSeconds)
      const currentTime =
        typeof player.currentTime === "number" &&
        Number.isFinite(player.currentTime)
          ? player.currentTime
          : 0
      const progress = duration != null ? currentTime / duration : 0
      const meaningful =
        currentTime >= MEANINGFUL_SECONDS || progress >= MEANINGFUL_PROGRESS
      if (!meaningful) return

      recordedRef.current = true
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

    player.addEventListener("timeupdate", evaluate)
    player.addEventListener("ended", evaluate)

    return () => {
      player.removeEventListener("timeupdate", evaluate)
      player.removeEventListener("ended", evaluate)
    }
  }, [durationSeconds, playerRef, videoDubId, videoId])

  return null
}
