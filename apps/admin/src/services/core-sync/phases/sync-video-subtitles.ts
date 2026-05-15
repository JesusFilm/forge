// Sync phase: video-subtitles
// Depends on: videos, languages, video-editions

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoSubtitleSchema } from "../schemas/video-subtitle"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"

const PAGE_SIZE = 10000

const VIDEO_SUBTITLES_QUERY = `
  query VideoSubtitles($offset: Int!, $limit: Int!, $where: VideoSubtitlesFilter) {
    videoSubtitles(offset: $offset, limit: $limit, where: $where) {
      id
      updatedAt
      videoId
      languageId
      primary
      edition
      vttSrc
      srtSrc
      value
      videoEdition { id }
    }
  }
`

type CoreVideoSubtitle = {
  id: string
  updatedAt: string
  videoId: string
  languageId: string
  primary: boolean
  edition: string
  vttSrc: string | null
  srtSrc: string | null
  value: string
  videoEdition: { id: string }
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

  while (true) {
    const result = await coreQuery<{ videoSubtitles: CoreVideoSubtitle[] }>(
      VIDEO_SUBTITLES_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawSubtitles = result.data?.videoSubtitles ?? []
    if (offset === 0 && rawSubtitles.length === 0) firstPageWasEmpty = true

    const parsedSubtitles =
      CoreVideoSubtitleSchema.array().safeParse(rawSubtitles)
    if (!parsedSubtitles.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-subtitle.parse-error",
          offset,
          issues: parsedSubtitles.error.issues,
        }),
      )
      progress.increment(rawSubtitles.length)
      if (rawSubtitles.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const subtitles = parsedSubtitles.data
    if (subtitles.length === 0) break
    progress.setTotal(offset + subtitles.length)

    try {
      let updated = 0
      await prisma.$transaction(async (tx) => {
        for (const subtitle of subtitles) {
          const videoId = videoMap.get(subtitle.videoId)
          const languageId = langMap.get(subtitle.languageId)
          const videoEditionId = editionMap.get(subtitle.videoEdition.id)
          if (!videoId || !videoEditionId) continue

          await tx.videoSubtitle.upsert({
            where: { coreId: subtitle.id },
            create: {
              coreId: subtitle.id,
              videoId,
              videoEditionId,
              languageId: languageId ?? null,
              value: subtitle.value,
              primary: subtitle.primary,
              vttSrc: subtitle.vttSrc,
              srtSrc: subtitle.srtSrc,
              syncedAt: new Date(),
            },
            update: {
              videoId,
              videoEditionId,
              languageId: languageId ?? null,
              value: subtitle.value,
              primary: subtitle.primary,
              vttSrc: subtitle.vttSrc,
              srtSrc: subtitle.srtSrc,
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
          updated++
        }
      }, CORE_SYNC_TRANSACTION_OPTIONS)
      stats.updated += updated
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

    progress.increment(subtitles.length)
    if (rawSubtitles.length < PAGE_SIZE) break
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
