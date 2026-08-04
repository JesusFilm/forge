import { prisma } from "@/db/client"

const COMPLETE_THRESHOLD = 0.9
const MAX_HISTORY_LIMIT = 200

export type WatchProgressInput = {
  videoId?: string | null
  /**
   * Alternative key for offline (downloaded) playback: the downloads
   * manifest stores only slugs, so queued entries arrive slug-keyed and
   * resolve to the video id server-side. Unknown slugs are dropped, never
   * misresolved. At least one of videoId / videoSlug must be present.
   */
  videoSlug?: string | null
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
  updatedAt?: string | null
}

export type WatchProgressView = {
  videoId: string
  languageSlug: string | null
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  updatedAt: string
}

function normalizeEntry(entry: WatchProgressInput & { videoId: string }) {
  const durationSeconds = Math.max(1, Math.floor(entry.durationSeconds))
  const positionSeconds = Math.floor(
    Math.min(Math.max(0, entry.positionSeconds), durationSeconds),
  )
  const lastWatchedAt =
    entry.updatedAt != null && Number.isFinite(Date.parse(entry.updatedAt))
      ? new Date(entry.updatedAt)
      : new Date()
  return {
    videoId: entry.videoId,
    languageSlug: entry.languageSlug?.trim() || null,
    positionSeconds,
    durationSeconds,
    completed: positionSeconds / durationSeconds >= COMPLETE_THRESHOLD,
    lastWatchedAt,
  }
}

/**
 * Resolve slug-keyed entries to id-keyed ones. Entries with a videoId keep
 * it (the slug is ignored); slug-only entries resolve against non-deleted
 * videos; unknown slugs and key-less entries are dropped.
 */
async function resolveEntryVideoIds(
  entries: WatchProgressInput[],
): Promise<Array<WatchProgressInput & { videoId: string }>> {
  const slugsToResolve = Array.from(
    new Set(
      entries
        .filter((entry) => !entry.videoId && entry.videoSlug)
        .map((entry) => entry.videoSlug as string),
    ),
  )
  const videoIdBySlug = new Map<string, string>()
  if (slugsToResolve.length > 0) {
    const videos = await prisma.video.findMany({
      where: { slug: { in: slugsToResolve }, deletedAt: null },
      select: { id: true, slug: true },
    })
    for (const video of videos) videoIdBySlug.set(video.slug, video.id)
  }
  const resolved: Array<WatchProgressInput & { videoId: string }> = []
  for (const entry of entries) {
    const videoId =
      entry.videoId ??
      (entry.videoSlug ? videoIdBySlug.get(entry.videoSlug) : undefined)
    if (videoId) resolved.push({ ...entry, videoId })
  }
  return resolved
}

function newestByVideoId<T extends { videoId: string; lastWatchedAt: Date }>(
  entries: T[],
): T[] {
  const newest = new Map<string, T>()
  for (const entry of entries) {
    const current = newest.get(entry.videoId)
    if (!current || entry.lastWatchedAt >= current.lastWatchedAt) {
      newest.set(entry.videoId, entry)
    }
  }
  return Array.from(newest.values())
}

function toView(row: {
  videoId: string
  positionSeconds: number
  durationSeconds: number
  languageSlug: string | null
  completed: boolean
  lastWatchedAt: Date
}): WatchProgressView {
  return {
    videoId: row.videoId,
    languageSlug: row.languageSlug,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    completed: row.completed,
    updatedAt: row.lastWatchedAt.toISOString(),
  }
}

export async function listWatchProgress({
  userId,
  limit = MAX_HISTORY_LIMIT,
}: {
  userId: string
  limit?: number
}): Promise<WatchProgressView[]> {
  const take = Math.min(Math.max(1, Math.floor(limit)), MAX_HISTORY_LIMIT)
  const rows = await prisma.watchProgress.findMany({
    where: { userId },
    orderBy: { lastWatchedAt: "desc" },
    take,
  })
  return rows.map(toView)
}

export async function upsertWatchProgress({
  userId,
  entries,
}: {
  userId: string
  entries: WatchProgressInput[]
}): Promise<WatchProgressView[]> {
  const idKeyedEntries = await resolveEntryVideoIds(entries)
  const normalized = newestByVideoId(idKeyedEntries.map(normalizeEntry))
  const uniqueVideoIds = Array.from(
    new Set(normalized.map((entry) => entry.videoId)),
  )
  const videos = await prisma.video.findMany({
    where: { id: { in: uniqueVideoIds }, deletedAt: null },
    select: { id: true },
  })
  const validVideoIds = new Set(videos.map((video) => video.id))
  const validEntriesForVideos = normalized.filter((entry) =>
    validVideoIds.has(entry.videoId),
  )
  const existingRows = await prisma.watchProgress.findMany({
    where: {
      userId,
      videoId: { in: validEntriesForVideos.map((entry) => entry.videoId) },
    },
    select: {
      videoId: true,
      lastWatchedAt: true,
    },
  })
  const existingByVideoId = new Map(
    existingRows.map((row) => [row.videoId, row]),
  )
  const validEntries = validEntriesForVideos.filter((entry) => {
    const current = existingByVideoId.get(entry.videoId)
    return !current || entry.lastWatchedAt >= current.lastWatchedAt
  })

  if (validEntries.length === 0) return []

  const rows = await prisma.$transaction(
    validEntries.map((entry) =>
      prisma.watchProgress.upsert({
        where: {
          userId_videoId: {
            userId,
            videoId: entry.videoId,
          },
        },
        create: {
          userId,
          videoId: entry.videoId,
          languageSlug: entry.languageSlug,
          positionSeconds: entry.positionSeconds,
          durationSeconds: entry.durationSeconds,
          completed: entry.completed,
          lastWatchedAt: entry.lastWatchedAt,
        },
        update: {
          positionSeconds: entry.positionSeconds,
          languageSlug: entry.languageSlug,
          durationSeconds: entry.durationSeconds,
          completed: entry.completed,
          lastWatchedAt: entry.lastWatchedAt,
        },
      }),
    ),
  )

  return rows.map(toView)
}

export async function deleteWatchProgressForUser(userId: string) {
  const result = await prisma.watchProgress.deleteMany({
    where: { userId },
  })
  return { deletedCount: result.count }
}

/** Per-video clear (R16) — removes one row, leaves the rest untouched. */
export async function deleteWatchProgressForVideo({
  userId,
  videoId,
}: {
  userId: string
  videoId: string
}) {
  const result = await prisma.watchProgress.deleteMany({
    where: { userId, videoId },
  })
  return { deletedCount: result.count }
}
