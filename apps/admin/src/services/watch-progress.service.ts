import { randomUUID } from "node:crypto"
import { prisma } from "@/db/client"
import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

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
  // Drop, never default to now: an unparseable stamp defaulted to server time
  // would win `last_watched_at <= EXCLUDED` and overwrite a newer position —
  // the exact staleness guard this field exists to feed.
  if (!Number.isFinite(clientMs)) return null
  const lastWatchedAt = new Date(Math.min(clientMs, Date.now()))
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
  const normalized = newestByVideoId(
    idKeyedEntries
      .map(normalizeEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  )
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

  return writeNewestWins(userId, validEntriesForVideos)
}

type NormalizedEntry = NonNullable<ReturnType<typeof normalizeEntry>>

/**
 * One statement for the whole batch. The staleness guard lives in the WRITE
 * (`WHERE … <= EXCLUDED`), not in a preceding read: a read-then-write pair
 * lets a second device commit between the two, so the last arrival would win
 * by timing rather than by recency and could rewind progress.
 *
 * RETURNING yields exactly the rows the guard admitted, so a losing entry is
 * reported as dropped rather than as written. The previous per-entry
 * update-then-create pair could not express this — on a concurrent-create
 * race it assumed the other writer was newer and discarded our entry even
 * when ours was the newer one.
 */
async function writeNewestWins(
  userId: string,
  entries: readonly NormalizedEntry[],
): Promise<WatchProgressView[]> {
  const ids = entries.map(() => randomUUID())
  const videoIds = entries.map((entry) => entry.videoId)
  const languageSlugs = entries.map((entry) => entry.languageSlug)
  const positions = entries.map((entry) => String(entry.positionSeconds))
  const durations = entries.map((entry) => String(entry.durationSeconds))
  const completions = entries.map((entry) => String(entry.completed))
  const watchedAts = entries.map((entry) => entry.lastWatchedAt.toISOString())

  // PG18 silently NULL-pads unequal-length unnest args instead of erroring.
  assertParallelArrayLengthsMatch(
    entries.length,
    [
      { name: "ids", length: ids.length },
      { name: "videoIds", length: videoIds.length },
      { name: "languageSlugs", length: languageSlugs.length },
      { name: "positions", length: positions.length },
      { name: "durations", length: durations.length },
      { name: "completions", length: completions.length },
      { name: "watchedAts", length: watchedAts.length },
    ],
    (message) => new Error(message),
  )

  // `newestByVideoId` above is load-bearing here, not just an optimisation:
  // Postgres aborts the whole statement if one ON CONFLICT target is hit
  // twice ("cannot affect row a second time").
  const rows = await prisma.$queryRaw<
    Array<{
      video_id: string
      language_slug: string | null
      position_seconds: number
      duration_seconds: number
      completed: boolean
      last_watched_at: Date
    }>
  >`
    INSERT INTO "watch_progress" (
      "id", "user_id", "video_id", "language_slug",
      "position_seconds", "duration_seconds", "completed",
      "last_watched_at", "updated_at"
    )
    SELECT
      u.id,
      ${userId},
      u.video_id,
      u.language_slug,
      u.position_seconds::int,
      u.duration_seconds::int,
      u.completed::boolean,
      -- The column is TIMESTAMP(3) (no zone) holding UTC wall-clock, which
      -- is what Prisma writes. Parsing as timestamptz first makes the
      -- conversion independent of the session TimeZone.
      (u.last_watched_at::timestamptz AT TIME ZONE 'UTC'),
      NOW()
    FROM unnest(
      ${toPgArray(ids)}::text[],
      ${toPgArray(videoIds)}::text[],
      ${toPgArray(languageSlugs)}::text[],
      ${toPgArray(positions)}::text[],
      ${toPgArray(durations)}::text[],
      ${toPgArray(completions)}::text[],
      ${toPgArray(watchedAts)}::text[]
    ) AS u(
      id, video_id, language_slug,
      position_seconds, duration_seconds, completed, last_watched_at
    )
    ON CONFLICT ("user_id", "video_id") DO UPDATE SET
      "language_slug"    = EXCLUDED."language_slug",
      "position_seconds" = EXCLUDED."position_seconds",
      "duration_seconds" = EXCLUDED."duration_seconds",
      "completed"        = EXCLUDED."completed",
      "last_watched_at"  = EXCLUDED."last_watched_at",
      "updated_at"       = NOW()
    WHERE "watch_progress"."last_watched_at" <= EXCLUDED."last_watched_at"
    RETURNING
      "video_id", "language_slug", "position_seconds",
      "duration_seconds", "completed", "last_watched_at"
  `

  return rows.map((row) =>
    toView({
      videoId: row.video_id,
      languageSlug: row.language_slug,
      positionSeconds: row.position_seconds,
      durationSeconds: row.duration_seconds,
      completed: row.completed,
      lastWatchedAt: row.last_watched_at,
    }),
  )
}

/** `client` lets a caller run this inside a transaction with a sibling
 *  erasure, so an account deletion never half-completes. */
export async function deleteWatchProgressForUser(
  userId: string,
  client: Pick<typeof prisma, "watchProgress"> = prisma,
) {
  const result = await client.watchProgress.deleteMany({
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
