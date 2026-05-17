// Sync phase: video-images
// Depends on: videos

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoImageSchema } from "../schemas/video-image"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"

const PAGE_SIZE = 10000

const VIDEO_IMAGES_QUERY = `
  query VideoImages($offset: Int!, $limit: Int!, $where: VideoImagesFilter) {
    videoImages(offset: $offset, limit: $limit, where: $where) {
      id
      updatedAt
      videoId
      aspectRatio
      url
      mobileCinematicHigh
      mobileCinematicLow
      mobileCinematicVeryLow
      thumbnail
      videoStill
      blurhash
    }
  }
`

type CoreVideoImage = {
  id: string
  updatedAt: string
  videoId: string | null
  aspectRatio: string | null
  url: string | null
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  mobileCinematicVeryLow: string | null
  thumbnail: string | null
  videoStill: string | null
  blurhash: string | null
}

export async function syncVideoImages({
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

  const videos = await prisma.video.findMany({
    select: { id: true, coreId: true },
  })
  const videoMap = new Map(videos.map((video) => [video.coreId, video.id]))

  let offset = 0
  let firstPageWasEmpty = false

  while (true) {
    const result = await coreQuery<{ videoImages: CoreVideoImage[] }>(
      VIDEO_IMAGES_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawImages = result.data?.videoImages ?? []
    if (offset === 0 && rawImages.length === 0) firstPageWasEmpty = true

    const parsedImages = CoreVideoImageSchema.array().safeParse(rawImages)
    if (!parsedImages.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-image.parse-error",
          offset,
          issues: parsedImages.error.issues,
        }),
      )
      progress.increment(rawImages.length)
      if (rawImages.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const images = parsedImages.data
    if (images.length === 0) break
    progress.setTotal(offset + images.length)

    try {
      let updated = 0
      await prisma.$transaction(async (tx) => {
        for (const image of images) {
          if (!image.videoId) continue
          const videoId = videoMap.get(image.videoId)
          if (!videoId) continue

          await tx.videoImage.upsert({
            where: { coreId: image.id },
            create: {
              coreId: image.id,
              videoId,
              url: image.url,
              aspectRatio: image.aspectRatio,
              mobileCinematicHigh: image.mobileCinematicHigh,
              mobileCinematicLow: image.mobileCinematicLow,
              mobileCinematicVeryLow: image.mobileCinematicVeryLow,
              thumbnail: image.thumbnail,
              videoStill: image.videoStill,
              blurhash: image.blurhash,
              syncedAt: new Date(),
            },
            update: {
              videoId,
              url: image.url,
              aspectRatio: image.aspectRatio,
              mobileCinematicHigh: image.mobileCinematicHigh,
              mobileCinematicLow: image.mobileCinematicLow,
              mobileCinematicVeryLow: image.mobileCinematicVeryLow,
              thumbnail: image.thumbnail,
              videoStill: image.videoStill,
              blurhash: image.blurhash,
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
          event: "core-sync.video-image.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(images.length)
    if (rawImages.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-image.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0) {
    const result = await prisma.videoImage.updateMany({
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
