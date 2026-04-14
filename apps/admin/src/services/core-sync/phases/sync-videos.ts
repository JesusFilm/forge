// Sync phase: videos
// The largest phase — syncs Video + VideoLocale rows.
// Depends on: languages (for primaryLanguageId FK)
//
// source='manager' rows are NEVER overwritten (short-circuit on upsert).

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoSchema } from "../schemas/video"
import { emptySyncStats } from "../types"

const VIDEOS_QUERY = `
  query Videos($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(
      offset: $offset
      limit: $limit
      where: $where
    ) {
      id
      slug
      label
      primaryLanguageId
      title { value language { bcp47 } }
      description { value language { bcp47 } }
      snippet { value language { bcp47 } }
      imageAlt { value language { bcp47 } }
      locked
      noIndex
      updatedAt
    }
  }
`

type CoreVideo = {
  id: string
  slug: string
  label: string | null
  primaryLanguageId: string | null
  title: Array<{ value: string; language: { bcp47?: string } }>
  description: Array<{ value: string; language: { bcp47?: string } }>
  snippet: Array<{ value: string; language: { bcp47?: string } }>
  imageAlt: Array<{ value: string; language: { bcp47?: string } }>
  locked: boolean
  noIndex: boolean
  updatedAt: string
}

export async function syncVideos({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  let offset = 0
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()

  while (true) {
    const result = await coreQuery<{ videos: CoreVideo[] }>(VIDEOS_QUERY, {
      offset,
      limit: PAGE_SIZE,
      where: {
        published: true,
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
    })

    const rawVideos = result.data?.videos ?? []
    if (offset === 0) {
      firstPageCount = rawVideos.length
    }

    const parsedVideos = CoreVideoSchema.array().safeParse(rawVideos)
    if (!parsedVideos.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video.parse-error",
          offset,
          issues: parsedVideos.error.issues,
        }),
      )
      progress.increment(rawVideos.length)
      if (rawVideos.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const videos = parsedVideos.data
    if (videos.length === 0) break

    if (!since) {
      for (const video of videos) {
        seenCoreIds.add(video.id)
      }
    }

    progress.setTotal(offset + videos.length)

    try {
      let pageUpdated = 0
      await prisma.$transaction(
        async (tx) => {
          for (const video of videos) {
            const primaryLanguageId = video.primaryLanguageId
              ? (langMap.get(video.primaryLanguageId) ?? null)
              : null

            const existing = await tx.video.findUnique({
              where: { coreId: video.id },
              select: { source: true },
            })
            if (existing?.source === "MANAGER") {
              continue
            }

            const videoRow = await tx.video.upsert({
              where: { coreId: video.id },
              create: {
                coreId: video.id,
                slug: video.slug,
                label: mapLabel(video.label),
                locked: video.locked,
                noIndex: video.noIndex,
                aiMetadata: false,
                source: "CORE",
                ...(primaryLanguageId ? { primaryLanguageId } : {}),
                updatedAt: new Date(video.updatedAt),
                syncedAt: new Date(),
              },
              update: {
                slug: video.slug,
                label: mapLabel(video.label),
                locked: video.locked,
                noIndex: video.noIndex,
                ...(primaryLanguageId ? { primaryLanguageId } : {}),
                updatedAt: new Date(video.updatedAt),
                syncedAt: new Date(),
                deletedAt: null,
              },
            })

            const locales = new Set<string>()
            for (const localizedValue of [
              ...video.title,
              ...video.description,
              ...video.snippet,
            ]) {
              if (localizedValue.language.bcp47) {
                locales.add(localizedValue.language.bcp47)
              }
            }

            for (const locale of locales) {
              const title =
                video.title.find((t) => t.language.bcp47 === locale)?.value ??
                null
              const description =
                video.description.find((d) => d.language.bcp47 === locale)
                  ?.value ?? null
              const snippet =
                video.snippet.find((s) => s.language.bcp47 === locale)?.value ??
                null
              const imageAlt =
                video.imageAlt.find((a) => a.language.bcp47 === locale)
                  ?.value ?? null

              await tx.videoLocale.upsert({
                where: {
                  videoId_locale: { videoId: videoRow.id, locale },
                },
                create: {
                  videoId: videoRow.id,
                  locale,
                  title,
                  description,
                  snippet,
                  imageAlt,
                  status: "PUBLISHED",
                },
                update: {
                  title,
                  description,
                  snippet,
                  imageAlt,
                },
              })
            }

            pageUpdated++
          }
        },
        { timeout: 5_000, maxWait: 2_000 },
      )
      stats.updated += pageUpdated
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(videos.length)

    if (videos.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageCount === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.video.updateMany({
      where: {
        source: "CORE",
        coreId: { notIn: [...seenCoreIds] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })
    stats.softDeleted += result.count
  }

  return stats
}

function mapLabel(
  label: string | null,
):
  | "COLLECTION"
  | "EPISODE"
  | "FEATURE_FILM"
  | "SEGMENT"
  | "SERIES"
  | "SHORT_FILM"
  | "TRAILER"
  | "BEHIND_THE_SCENES"
  | null {
  if (!label) return null
  const MAP: Record<string, string> = {
    collection: "COLLECTION",
    episode: "EPISODE",
    featureFilm: "FEATURE_FILM",
    segment: "SEGMENT",
    series: "SERIES",
    shortFilm: "SHORT_FILM",
    trailer: "TRAILER",
    behindTheScenes: "BEHIND_THE_SCENES",
  }
  return (MAP[label] as ReturnType<typeof mapLabel>) ?? null
}
