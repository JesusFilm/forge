// Sync phase: video-dubs (formerly video-variants in Core)
//
// Boundary translation: Core's `videoVariant` → admin's `VideoDub`.
// The varying axis is the audio language (a dub), not the frames.
// Depends on: videos, languages

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreDubSchema } from "../schemas/dub"
import { emptySyncStats } from "../types"

const DUBS_QUERY = `
  query VideoVariants($offset: Int!, $limit: Int!, $input: VideoVariantFilter) {
    videoVariants(
      offset: $offset
      limit: $limit
      input: $input
    ) {
      id
      videoId
      slug
      duration
      lengthInMilliseconds
      hls
      dash
      share
      downloadable
      published
      updatedAt
      language { id }
    }
  }
`

type CoreVariant = {
  id: string
  videoId: string
  slug: string | null
  language: { id: string } | null
  duration: number
  lengthInMilliseconds: string | number | null
  hls: string | null
  dash: string | null
  share: string | null
  downloadable: boolean
  published: boolean
  updatedAt: string
}

export async function syncDubs({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  const videos = await prisma.video.findMany({
    select: { id: true, coreId: true },
  })
  const videoMap = new Map(videos.map((v) => [v.coreId, v.id]))

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  let offset = 0
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()

  while (true) {
    const result = await coreQuery<{ videoVariants: CoreVariant[] }>(
      DUBS_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        input: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawVariants = result.data?.videoVariants ?? []
    if (offset === 0) {
      firstPageCount = rawVariants.length
    }

    const parsedVariants = CoreDubSchema.array().safeParse(rawVariants)
    if (!parsedVariants.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.parse-error",
          offset,
          issues: parsedVariants.error.issues,
        }),
      )
      progress.increment(rawVariants.length)
      if (rawVariants.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const variants = parsedVariants.data
    if (variants.length === 0) break

    if (!since) {
      for (const variant of variants) {
        seenCoreIds.add(variant.id)
      }
    }

    progress.setTotal(offset + variants.length)

    try {
      let pageUpdated = 0
      await prisma.$transaction(
        async (tx) => {
          for (const variant of variants) {
            const videoId = videoMap.get(variant.videoId)
            if (!videoId) {
              throw new Error(
                `Missing video for dub ${variant.id} (${variant.videoId})`,
              )
            }

            const existingDub = await tx.videoDub.findUnique({
              where: { coreId: variant.id },
              select: { source: true },
            })
            if (existingDub?.source === "MANAGER") {
              continue
            }

            const languageId = variant.language
              ? (langMap.get(variant.language.id) ?? null)
              : null

            await tx.videoDub.upsert({
              where: { coreId: variant.id },
              create: {
                coreId: variant.id,
                videoId,
                slug: variant.slug,
                duration: variant.duration,
                lengthInMilliseconds: variant.lengthInMilliseconds
                  ? BigInt(variant.lengthInMilliseconds)
                  : null,
                hls: variant.hls,
                dash: variant.dash,
                share: variant.share,
                downloadable: variant.downloadable,
                published: variant.published,
                source: "CORE",
                ...(languageId ? { languageId } : {}),
                updatedAt: new Date(variant.updatedAt),
                syncedAt: new Date(),
              },
              update: {
                slug: variant.slug,
                duration: variant.duration,
                lengthInMilliseconds: variant.lengthInMilliseconds
                  ? BigInt(variant.lengthInMilliseconds)
                  : null,
                hls: variant.hls,
                dash: variant.dash,
                share: variant.share,
                downloadable: variant.downloadable,
                published: variant.published,
                ...(languageId ? { languageId } : {}),
                updatedAt: new Date(variant.updatedAt),
                syncedAt: new Date(),
                deletedAt: null,
              },
            })
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
          event: "core-sync.video-dub.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(variants.length)

    if (variants.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageCount === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-dub.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.videoDub.updateMany({
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
