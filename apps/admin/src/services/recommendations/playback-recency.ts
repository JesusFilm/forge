import type { RecommendationPlaybackEpisode, Prisma } from "@prisma/client"
import { env } from "@/config/env"
import type { RecommendationPlaybackEvent } from "./contracts"
import { RecommendationInternalStateError } from "./errors"

/** Compact capture is opt-in for untouched roots, but a root already using it
 * must continue through a reader rollback so its watermark stays complete. */
export function preparePlaybackRecencyCapture(input: {
  episode: RecommendationPlaybackEpisode
  existingFactCount: number
  pending: ReadonlyArray<{
    event: RecommendationPlaybackEvent
    sequence: number
    late: boolean
  }>
  receivedAt: Date
  enabled?: boolean
}): {
  episodeUpdate: Prisma.RecommendationPlaybackEpisodeUpdateManyMutationInput
  intervals: Prisma.RecommendationPlaybackRecencyIntervalCreateManyInput[]
} | null {
  const { episode, existingFactCount, pending, receivedAt } = input
  const enabled =
    input.enabled ??
    env.RECOMMENDATION_COMPACT_PLAYBACK_RECENCY_READER_ENABLED === "1"
  if (
    episode.recencyFormatVersion !== 1 &&
    !(enabled && existingFactCount === 0 && episode.nextFactSequence === 1)
  )
    return null
  if (
    episode.recencyFormatVersion === 1 &&
    episode.recencyFactWatermark !== episode.nextFactSequence - 1
  ) {
    throw new RecommendationInternalStateError(
      "Recommendation playback recency state is incomplete",
    )
  }
  const intervals: Prisma.RecommendationPlaybackRecencyIntervalCreateManyInput[] =
    []
  let startReceivedAt = episode.recencyStartReceivedAt
  let startExpiresAt = episode.recencyStartExpiresAt
  let hasLate = episode.recencyHasLate
  for (const { event, sequence, late } of pending) {
    if (late) hasLate = true
    if (event.kind === "playback_start" && !late) {
      startReceivedAt = receivedAt
      startExpiresAt = episode.expiresAt
    }
    if (
      event.kind !== "playback_active_visible_playing" ||
      late ||
      event.payload.activeMilliseconds < 1
    )
      continue
    const intervalEnd = new Date(event.occurredAt)
    intervals.push({
      episodeId: episode.id,
      sequence,
      receivedAt,
      intervalStart: new Date(
        intervalEnd.getTime() - event.payload.activeMilliseconds,
      ),
      intervalEnd,
      expiresAt: episode.expiresAt,
    })
  }
  const intervalCount = episode.recencyIntervalCount + intervals.length
  if (intervalCount > 64)
    throw new RecommendationInternalStateError(
      "Recommendation playback recency interval limit exceeded",
    )
  return {
    episodeUpdate: {
      recencyFormatVersion: 1,
      recencyFactWatermark: episode.nextFactSequence + pending.length - 1,
      recencyIntervalCount: intervalCount,
      recencyHasStart: startReceivedAt != null,
      recencyStartReceivedAt: startReceivedAt,
      recencyStartExpiresAt: startExpiresAt,
      recencyHasLate: hasLate,
    },
    intervals,
  }
}
