// Sync phase: video-images
// Depends on: videos
//
// Data source rationale: this phase walks Core's `videos(...) { images { ... } }`
// nested field rather than the flat `videoImages(...)` list. The flat list is
// a sparse subset (~270 records catalogue-wide) — most of Core's image data
// only surfaces via the per-Video nested field. Using the nested path
// matches watch-modern's behavior and recovers the marketing posters /
// stills that admin's earlier flat-list sync missed.

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoImageSchema } from "../schemas/video-image"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"

// 100 videos × ~2 images each = ~200 image rows per response. Conservative
// page size to keep Core's response under its per-call cost ceiling — the
// `Video.images` join can fan out wider on collection-shaped videos.
const PAGE_SIZE = 100

const VIDEOS_WITH_IMAGES_QUERY = `
  query VideosWithImages($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(offset: $offset, limit: $limit, where: $where) {
      id
      images {
        id
        updatedAt
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
  }
`

type CoreVideoWithImages = {
  id: string
  images: Array<{
    id: string
    updatedAt: string
    aspectRatio: string | null
    url: string | null
    mobileCinematicHigh: string | null
    mobileCinematicLow: string | null
    mobileCinematicVeryLow: string | null
    thumbnail: string | null
    videoStill: string | null
    blurhash: string | null
  }>
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
    const result = await coreQuery<{ videos: CoreVideoWithImages[] }>(
      VIDEOS_WITH_IMAGES_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        // Filter by parent-video updatedAt. Edge: an image touched after
        // its parent video was last touched won't be picked up by an
        // incremental sync until the next full sync. Acceptable trade-off
        // for the coverage win — full sync (no `since`) refreshes
        // everything regardless.
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawVideos = result.data?.videos ?? []
    if (offset === 0 && rawVideos.length === 0) firstPageWasEmpty = true

    // Flatten { video.id, video.images[] } → image rows with parent's id
    // injected as `videoId`. Matches the shape `CoreVideoImageSchema`
    // expects so existing validation + upsert paths stay byte-equal.
    const rawImages = rawVideos.flatMap((video) =>
      video.images.map((image) => ({
        ...image,
        videoId: video.id,
      })),
    )

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
      if (rawVideos.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const images = parsedImages.data
    if (rawVideos.length === 0) break
    progress.setTotal(offset * 2 + images.length)

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

    progress.increment(rawVideos.length)
    if (rawVideos.length < PAGE_SIZE) break
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
