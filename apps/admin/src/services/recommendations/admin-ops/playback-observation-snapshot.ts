import { Prisma, type PrismaClient } from "@prisma/client"
import {
  loadPlaybackObservationWindow,
  type PlaybackObservationWindow,
} from "./playback-observation-window"
import {
  resolveRecommendationOpsWindow,
  type RecommendationOpsWindowPreset,
} from "./shared"

export const PLAYBACK_OBSERVATION_SNAPSHOT_VERSION =
  "playback-observation-snapshot-v1"
export const PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS = [
  "24h",
  "7d",
  "29d",
] as const
const STALE_AFTER_MS = 48 * 60 * 60 * 1_000
const RECENT_SUCCESS_MS = 60 * 60 * 1_000
const LOCK_ID = 370_000_010

export type PlaybackObservationSnapshot = Readonly<{
  window: PlaybackObservationWindow | null
  windowStart: Date | null
  windowEnd: Date | null
  computedAt: Date | null
  lastAttemptedAt: Date | null
  refreshFailed: boolean
  stale: boolean
}>

export async function loadPlaybackObservationSnapshot(
  prisma: Pick<PrismaClient, "recommendationPlaybackObservationSnapshot">,
  preset: RecommendationOpsWindowPreset,
  now: Date,
): Promise<PlaybackObservationSnapshot> {
  const row = await prisma.recommendationPlaybackObservationSnapshot.findUnique(
    {
      where: { preset },
    },
  )
  const valid =
    row?.schemaVersion === PLAYBACK_OBSERVATION_SNAPSHOT_VERSION &&
    row.payload != null &&
    row.windowStart != null &&
    row.windowEnd != null &&
    row.computedAt != null
  return {
    window: valid
      ? (row.payload as unknown as PlaybackObservationWindow)
      : null,
    windowStart: valid ? row.windowStart : null,
    windowEnd: valid ? row.windowEnd : null,
    computedAt: valid ? row.computedAt : null,
    lastAttemptedAt: row?.lastAttemptedAt ?? null,
    refreshFailed: row?.lastErrorCode != null,
    stale:
      !valid ||
      now.getTime() - (row?.computedAt?.getTime() ?? 0) > STALE_AFTER_MS,
  }
}

/** Each preset commits independently; one slow window cannot erase another. */
export async function refreshPlaybackObservationSnapshots(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{
  refreshed: RecommendationOpsWindowPreset[]
  failed: RecommendationOpsWindowPreset[]
}> {
  const refreshed: RecommendationOpsWindowPreset[] = []
  const failed: RecommendationOpsWindowPreset[] = []
  for (const [
    index,
    preset,
  ] of PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS.entries()) {
    try {
      const didRefresh = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '30000ms'`
          await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
          await tx.$executeRaw`SET LOCAL jit = off`
          const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
            SELECT pg_try_advisory_xact_lock(${LOCK_ID + index}) AS locked
          `
          if (!lock[0]?.locked) return false
          const previous =
            await tx.recommendationPlaybackObservationSnapshot.findUnique({
              where: { preset },
              select: {
                schemaVersion: true,
                computedAt: true,
                lastErrorCode: true,
                payload: true,
              },
            })
          if (previous?.computedAt != null && previous.computedAt >= now)
            return false
          if (
            previous?.schemaVersion === PLAYBACK_OBSERVATION_SNAPSHOT_VERSION &&
            previous.computedAt != null &&
            previous.payload != null &&
            previous.lastErrorCode == null &&
            now.getTime() - previous.computedAt.getTime() < RECENT_SUCCESS_MS
          )
            return false
          const window = resolveRecommendationOpsWindow(preset, now)
          const payload = await loadPlaybackObservationWindow(tx, window, now)
          await tx.recommendationPlaybackObservationSnapshot.upsert({
            where: { preset },
            create: {
              preset,
              schemaVersion: PLAYBACK_OBSERVATION_SNAPSHOT_VERSION,
              windowStart: window.start,
              windowEnd: window.end,
              computedAt: now,
              payload: payload as unknown as Prisma.InputJsonValue,
              lastAttemptedAt: now,
            },
            update: {
              schemaVersion: PLAYBACK_OBSERVATION_SNAPSHOT_VERSION,
              windowStart: window.start,
              windowEnd: window.end,
              computedAt: now,
              payload: payload as unknown as Prisma.InputJsonValue,
              lastAttemptedAt: now,
              lastErrorCode: null,
            },
          })
          return true
        },
        { maxWait: 1000, timeout: 35000 },
      )
      if (didRefresh) refreshed.push(preset)
    } catch (error) {
      failed.push(preset)
      console.warn(
        "[recommendations] playback observation snapshot refresh failed",
        {
          preset,
          error: error instanceof Error ? error.name : "unknown",
        },
      )
      await recordSnapshotRefreshFailure(prisma, preset, now).catch(() => {})
    }
  }
  return { refreshed, failed }
}

async function recordSnapshotRefreshFailure(
  prisma: PrismaClient,
  preset: RecommendationOpsWindowPreset,
  now: Date,
): Promise<void> {
  const updated =
    await prisma.recommendationPlaybackObservationSnapshot.updateMany({
      where: {
        preset,
        lastAttemptedAt: { lte: now },
        OR: [{ computedAt: null }, { computedAt: { lt: now } }],
      },
      data: { lastAttemptedAt: now, lastErrorCode: "refresh_failed" },
    })
  if (updated.count > 0) return
  const existing =
    await prisma.recommendationPlaybackObservationSnapshot.findUnique({
      where: { preset },
      select: { preset: true },
    })
  if (existing) return
  await prisma.recommendationPlaybackObservationSnapshot
    .create({
      data: {
        preset,
        schemaVersion: PLAYBACK_OBSERVATION_SNAPSHOT_VERSION,
        lastAttemptedAt: now,
        lastErrorCode: "refresh_failed",
      },
    })
    .catch(() => {})
}
