// Sync phase: video-subtitles
// Depends on: videos, languages, video-editions
//
// Paginates over `videos(offset, limit)` and reads `subtitles` inline
// on each video. The old top-level `videoSubtitles(offset, limit)` query
// does not exist in the Core gateway — it silently returned empty pages
// and the soft-delete pass wiped every synced subtitle.

import type { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoSubtitleSchema } from "../schemas/video-subtitle"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

const PAGE_SIZE = 50

const VIDEO_SUBTITLES_QUERY = `
  query VideoSubtitlesViaVideos($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(offset: $offset, limit: $limit, where: $where) {
      id
      subtitles {
        id
        languageId
        primary
        edition
        vttSrc
        srtSrc
        value
        videoEdition { id }
      }
    }
  }
`

type CoreSubtitleRaw = {
  id: string
  languageId: string
  primary: boolean
  edition: string
  vttSrc: string | null
  srtSrc: string | null
  value: string
  videoEdition: { id: string }
}

type CoreVideoWithSubtitles = {
  id: string
  subtitles: CoreSubtitleRaw[]
}

type SubtitleWrite = {
  id: string
  coreId: string
  videoId: string
  videoEditionId: string
  languageId: string | null
  value: string
  primary: string
  vttSrc: string | null
  srtSrc: string | null
}

class VideoSubtitleSyncBulkWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoSubtitleSyncBulkWriteError"
  }
}

function assertSubtitleWriteLengths(subtitles: readonly SubtitleWrite[]) {
  assertParallelArrayLengthsMatch(
    subtitles.length,
    [
      { name: "ids", length: subtitles.length },
      { name: "coreIds", length: subtitles.length },
      { name: "videoIds", length: subtitles.length },
      { name: "videoEditionIds", length: subtitles.length },
      { name: "languageIds", length: subtitles.length },
      { name: "values", length: subtitles.length },
      { name: "primaryValues", length: subtitles.length },
      { name: "vttSrcs", length: subtitles.length },
      { name: "srtSrcs", length: subtitles.length },
    ],
    (message) => new VideoSubtitleSyncBulkWriteError(message),
  )
}

async function bulkUpsertVideoSubtitles(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  subtitles: readonly SubtitleWrite[],
) {
  if (subtitles.length === 0) return 0

  assertSubtitleWriteLengths(subtitles)

  return tx.$executeRaw`
    INSERT INTO "video_subtitle" (
      "id",
      "core_id",
      "source",
      "video_id",
      "video_edition_id",
      "language_id",
      "value",
      "primary",
      "vtt_src",
      "srt_src",
      "ai_generated",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."video_id",
      input."video_edition_id",
      input."language_id",
      input."value",
      input."primary_text"::boolean,
      input."vtt_src",
      input."srt_src",
      false,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(subtitles.map((subtitle) => subtitle.id))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.coreId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.videoId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.videoEditionId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.languageId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.value))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.primary))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.vttSrc))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.srtSrc))}::text[]
    ) AS input(
      "id",
      "core_id",
      "video_id",
      "video_edition_id",
      "language_id",
      "value",
      "primary_text",
      "vtt_src",
      "srt_src"
    )
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "video_id"         = EXCLUDED."video_id",
      "video_edition_id" = EXCLUDED."video_edition_id",
      "language_id"      = EXCLUDED."language_id",
      "value"            = EXCLUDED."value",
      "primary"          = EXCLUDED."primary",
      "vtt_src"          = EXCLUDED."vtt_src",
      "srt_src"          = EXCLUDED."srt_src",
      "synced_at"        = EXCLUDED."synced_at",
      "updated_at"       = EXCLUDED."updated_at",
      "deleted_at"       = NULL
    WHERE
      "video_subtitle"."deleted_at" IS NOT NULL
      OR "video_subtitle"."video_id" IS DISTINCT FROM EXCLUDED."video_id"
      OR "video_subtitle"."video_edition_id" IS DISTINCT FROM EXCLUDED."video_edition_id"
      OR "video_subtitle"."language_id" IS DISTINCT FROM EXCLUDED."language_id"
      OR "video_subtitle"."value" IS DISTINCT FROM EXCLUDED."value"
      OR "video_subtitle"."primary" IS DISTINCT FROM EXCLUDED."primary"
      OR "video_subtitle"."vtt_src" IS DISTINCT FROM EXCLUDED."vtt_src"
      OR "video_subtitle"."srt_src" IS DISTINCT FROM EXCLUDED."srt_src"
  `
}

export async function syncVideoSubtitles({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }
  const phaseStartedAt = new Date()

  const [videos, languages, editions] = await Promise.all([
    prisma.video.findMany({ select: { id: true, coreId: true } }),
    prisma.language.findMany({ select: { id: true, coreId: true } }),
    prisma.videoEdition.findMany({ select: { id: true, coreId: true } }),
  ])
  const videoMap = new Map(videos.map((video) => [video.coreId, video.id]))
  const langMap = new Map(
    languages.map((language) => [language.coreId, language.id]),
  )
  const editionMap = new Map(
    editions.map((edition) => [edition.coreId, edition.id]),
  )

  let offset = 0
  let firstPageWasEmpty = false
  let totalSubtitlesSeen = 0

  while (true) {
    let rawVideos: CoreVideoWithSubtitles[]

    try {
      const result = await coreQuery<{ videos: CoreVideoWithSubtitles[] }>(
        VIDEO_SUBTITLES_QUERY,
        {
          offset,
          limit: PAGE_SIZE,
          where: since ? { updatedAt: { gte: since } } : undefined,
        },
      )
      rawVideos = result.data?.videos ?? []
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-subtitle.page.error",
          offset,
          pageSize: PAGE_SIZE,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      if (offset === 0) firstPageWasEmpty = true
      offset += PAGE_SIZE
      continue
    }

    if (offset === 0 && rawVideos.length === 0) firstPageWasEmpty = true
    if (rawVideos.length === 0) break

    const allSubtitles: Array<CoreSubtitleRaw & { videoId: string }> = []
    for (const video of rawVideos) {
      for (const sub of video.subtitles ?? []) {
        allSubtitles.push({ ...sub, videoId: video.id })
      }
    }

    progress.setTotal(totalSubtitlesSeen + allSubtitles.length)

    if (allSubtitles.length > 0) {
      const parsedSubtitles = CoreVideoSubtitleSchema.array().safeParse(
        allSubtitles.map(({ videoId: _, ...rest }) => rest),
      )
      if (!parsedSubtitles.success) {
        stats.errors++
        console.error(
          JSON.stringify({
            event: "core-sync.video-subtitle.parse-error",
            offset,
            issues: parsedSubtitles.error.issues,
          }),
        )
        progress.increment(allSubtitles.length)
        totalSubtitlesSeen += allSubtitles.length
        offset += PAGE_SIZE
        if (rawVideos.length < PAGE_SIZE) break
        continue
      }

      try {
        const writes = allSubtitles.flatMap((subtitle): SubtitleWrite[] => {
          const videoId = videoMap.get(subtitle.videoId)
          const languageId = langMap.get(subtitle.languageId)
          const videoEditionId = editionMap.get(subtitle.videoEdition.id)
          if (!videoId || !videoEditionId) return []

          return [
            {
              id: randomUUID(),
              coreId: subtitle.id,
              videoId,
              videoEditionId,
              languageId: languageId ?? null,
              value: subtitle.value,
              primary: String(subtitle.primary),
              vttSrc: subtitle.vttSrc,
              srtSrc: subtitle.srtSrc,
            },
          ]
        })

        await prisma.$transaction(async (tx) => {
          await bulkUpsertVideoSubtitles(tx, writes)
        }, CORE_SYNC_TRANSACTION_OPTIONS)
        stats.updated += writes.length
      } catch (err) {
        stats.errors++
        console.error(
          JSON.stringify({
            event: "core-sync.video-subtitle.error",
            offset,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    }

    progress.increment(allSubtitles.length)
    totalSubtitlesSeen += allSubtitles.length
    if (rawVideos.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-subtitle.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0) {
    const result = await prisma.videoSubtitle.updateMany({
      where: {
        source: "CORE",
        deletedAt: null,
        OR: [{ syncedAt: null }, { syncedAt: { lt: phaseStartedAt } }],
      },
      data: { deletedAt: new Date() },
    })
    stats.softDeleted += result.count
  }

  return stats
}
