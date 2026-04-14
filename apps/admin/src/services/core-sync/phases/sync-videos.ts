// Sync phase: videos
// The largest phase — syncs Video + VideoLocale + VideoImage rows.
// Depends on: languages (for primaryLanguageId FK)
//
// source='manager' rows are NEVER overwritten (short-circuit on upsert).

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { emptySyncStats } from "../types"

const VIDEOS_QUERY = `
  query Videos($offset: Int!, $limit: Int!, $since: String) {
    videos(
      offset: $offset
      limit: $limit
      where: { updatedAt_gt: $since }
    ) {
      id
      slug
      label
      primaryLanguageId
      title { value language { bcp47 } }
      description { value language { bcp47 } }
      snippet { value language { bcp47 } }
      imageAlt { value language { bcp47 } }
      image
      locked
      noIndex
      publishDate
      updatedAt
    }
  }
`

type CoreVideo = {
  id: string
  slug: string
  label: string | null
  primaryLanguageId: string | null
  title: Array<{ value: string; language: { bcp47: string } }>
  description: Array<{ value: string; language: { bcp47: string } }>
  snippet: Array<{ value: string; language: { bcp47: string } }>
  imageAlt: Array<{ value: string; language: { bcp47: string } }>
  image: string | null
  locked: boolean
  noIndex: boolean
  publishDate: string | null
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

  // Build language coreId → id map
  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  let offset = 0

  while (true) {
    const result = await coreQuery<{ videos: CoreVideo[] }>(VIDEOS_QUERY, {
      offset,
      limit: PAGE_SIZE,
      since: since ?? null,
    })

    const videos = result.data?.videos ?? []
    if (videos.length === 0) break
    progress.setTotal(offset + videos.length)

    for (const v of videos) {
      try {
        const primaryLanguageId = v.primaryLanguageId
          ? (langMap.get(v.primaryLanguageId) ?? null)
          : null

        // Short-circuit: never overwrite source='manager' rows
        const existing = await prisma.video.findUnique({
          where: { coreId: v.id },
          select: { id: true, source: true },
        })
        if (existing?.source === "MANAGER") {
          progress.increment()
          continue
        }

        const videoRow = await prisma.video.upsert({
          where: { coreId: v.id },
          create: {
            coreId: v.id,
            slug: v.slug,
            label: mapLabel(v.label),
            locked: v.locked,
            noIndex: v.noIndex,
            aiMetadata: false,
            source: "CORE",
            ...(primaryLanguageId ? { primaryLanguageId } : {}),
            updatedAt: new Date(v.updatedAt),
            syncedAt: new Date(),
          },
          update: {
            slug: v.slug,
            label: mapLabel(v.label),
            locked: v.locked,
            noIndex: v.noIndex,
            ...(primaryLanguageId ? { primaryLanguageId } : {}),
            updatedAt: new Date(v.updatedAt),
            syncedAt: new Date(),
          },
        })

        // Upsert per-locale VideoLocale rows from title/description/snippet
        const locales = new Set<string>()
        for (const t of [...v.title, ...v.description, ...v.snippet]) {
          locales.add(t.language.bcp47)
        }

        for (const locale of locales) {
          const title =
            v.title.find((t) => t.language.bcp47 === locale)?.value ?? null
          const description =
            v.description.find((d) => d.language.bcp47 === locale)?.value ??
            null
          const snippetVal =
            v.snippet.find((s) => s.language.bcp47 === locale)?.value ?? null
          const imageAltVal =
            v.imageAlt.find((a) => a.language.bcp47 === locale)?.value ?? null

          await prisma.videoLocale.upsert({
            where: {
              videoId_locale: { videoId: videoRow.id, locale },
            },
            create: {
              videoId: videoRow.id,
              locale,
              title,
              description,
              snippet: snippetVal,
              imageAlt: imageAltVal,
              status: "PUBLISHED",
            },
            update: {
              title,
              description,
              snippet: snippetVal,
              imageAlt: imageAltVal,
            },
          })
        }

        stats.updated++
      } catch (err) {
        stats.errors++
        console.error(
          JSON.stringify({
            event: "core-sync.video.error",
            coreId: v.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
      progress.increment()
    }

    if (videos.length < PAGE_SIZE) break
    offset += PAGE_SIZE
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
