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
  // Clamp to server time: a client cannot legitimately record a future
  // position, and an unclamped skewed clock would win the staleness guard
  // against every later write, freezing the row permanently.
  const clientMs =
    entry.updatedAt != null ? Date.parse(entry.updatedAt) : Number.NaN
  const lastWatchedAt = Number.isFinite(clientMs)
    ? new Date(Math.min(clientMs, Date.now()))
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

/** Prisma's unique-constraint violation — the concurrent-create race. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
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
  if (validEntriesForVideos.length === 0) return []

  // The staleness guard lives in the WRITE, not in a preceding read: a
  // read-then-write pair lets a second device commit between the two, so the
  // last arrival won by timing rather than by recency and could rewind
  // progress. Each entry is independently atomic; there is no cross-entry
  // invariant, so no batch transaction (which would also make the
  // unique-violation path below poison the whole statement in Postgres).
  const accepted: WatchProgressView[] = []
  for (const entry of validEntriesForVideos) {
    const data = {
      languageSlug: entry.languageSlug,
      positionSeconds: entry.positionSeconds,
      durationSeconds: entry.durationSeconds,
      completed: entry.completed,
      lastWatchedAt: entry.lastWatchedAt,
    }
    const updated = await prisma.watchProgress.updateMany({
      where: {
        userId,
        videoId: entry.videoId,
        lastWatchedAt: { lte: entry.lastWatchedAt },
      },
      data,
    })
    if (updated.count > 0) {
      accepted.push(toView({ videoId: entry.videoId, ...data }))
      continue
    }
    // Nothing updated: either no row exists yet, or a newer one already does.
    try {
      const created = await prisma.watchProgress.create({
        data: { userId, videoId: entry.videoId, ...data },
      })
      accepted.push(toView(created))
    } catch (error) {
      // A concurrent writer created the row first; its value is newer than
      // ours by definition, so dropping this entry is the correct outcome.
      if (!isUniqueViolation(error)) throw error
    }
  }

  return accepted
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
