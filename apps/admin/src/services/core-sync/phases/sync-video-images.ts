// Sync phase: video-images
// Depends on: videos
//
// Data source rationale: this phase's primary walk uses Core's
// `videos(...) { images { ... } }` nested field rather than the flat
// `videoImages(...)` list. The flat list is a sparse subset (~270 records
// catalogue-wide) — most of Core's image data only surfaces via the
// per-Video nested field. Using the nested path matches watch-modern's
// behavior and recovers the marketing posters / stills that admin's
// earlier flat-list sync missed. An incremental run also makes a
// supplementary pass over the flat list (see
// `syncVideoImagesByOwnUpdatedAt` below) filtered by the image's own
// `updatedAt`, to self-heal images touched without their parent video
// also being touched.

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
  }>
}

// Supplementary incremental pass: Core also exposes a flat, top-level
// `videoImages` list that can be filtered by the image's OWN `updatedAt`
// (unlike the nested walk above, which can only filter by the parent
// video's `updatedAt`). This catches the case where an image is touched
// in Core without its parent video also being touched, which the nested
// walk's incremental filter would otherwise miss until the next full sync.
// The flat list itself is a sparse subset of the catalogue (most images
// only surface via the nested path), so it stays a *supplementary*
// self-heal pass, not a replacement for the nested walk.
const VIDEO_IMAGES_BY_OWN_UPDATED_AT_QUERY = `
  query VideoImagesByOwnUpdatedAt($offset: Int!, $limit: Int!, $where: VideoImagesFilter) {
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
    }
  }
`

type CoreFlatVideoImage = {
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
}

function videoImageUpsertArgs(
  image: Pick<
    CoreFlatVideoImage,
    | "id"
    | "url"
    | "aspectRatio"
    | "mobileCinematicHigh"
    | "mobileCinematicLow"
    | "mobileCinematicVeryLow"
    | "thumbnail"
    | "videoStill"
  >,
  videoId: string,
) {
  return {
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
      syncedAt: new Date(),
      deletedAt: null,
    },
  }
}

async function syncVideoImagesByOwnUpdatedAt({
  prisma,
  videoMap,
  stats,
  since,
}: {
  prisma: PrismaClient
  videoMap: Map<string, string>
  stats: SyncStats
  since: string
}): Promise<void> {
  let offset = 0

  while (true) {
    let rawImages: CoreFlatVideoImage[] = []
    try {
      const result = await coreQuery<{ videoImages: CoreFlatVideoImage[] }>(
        VIDEO_IMAGES_BY_OWN_UPDATED_AT_QUERY,
        {
          offset,
          limit: PAGE_SIZE,
          where: { updatedAt: { gte: since } },
        },
      )
      rawImages = result.data?.videoImages ?? []
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-image.own-updated-at.page.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      offset += PAGE_SIZE
      continue
    }

    if (rawImages.length === 0) break

    const parsedImages = CoreVideoImageSchema.array().safeParse(rawImages)
    if (!parsedImages.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-image.own-updated-at.parse-error",
          offset,
          issues: parsedImages.error.issues,
        }),
      )
      if (rawImages.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const images = parsedImages.data
    try {
      let skippedMissingVideo = 0
      await prisma.$transaction(async (tx) => {
        for (const image of images) {
          if (!image.videoId) continue
          const videoId = videoMap.get(image.videoId)
          if (!videoId) {
            skippedMissingVideo++
            continue
          }

          await tx.videoImage.upsert(videoImageUpsertArgs(image, videoId))
          stats.updated++
        }
      }, CORE_SYNC_TRANSACTION_OPTIONS)
      if (skippedMissingVideo > 0) {
        console.warn(
          JSON.stringify({
            event:
              "core-sync.video-image.own-updated-at.skipped-missing-videos",
            offset,
            count: skippedMissingVideo,
          }),
        )
      }
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-image.own-updated-at.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    if (rawImages.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
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
  // Track every coreId we successfully saw this run so the post-loop
  // soft-delete only fires after a non-empty walk completed. Mirrors the
  // `seenCoreIds.size > 0` guard sibling phases (sync-videos, sync-dubs)
  // use to defend against a transient mid-pagination empty page tombstoning
  // the entire catalogue. Per-page try/catch around `coreQuery` also added
  // below so a single Core hiccup advances `offset` without breaking the loop.
  const seenCoreIds = new Set<string>()

  while (true) {
    let rawVideos: CoreVideoWithImages[] = []
    try {
      const result = await coreQuery<{ videos: CoreVideoWithImages[] }>(
        VIDEOS_WITH_IMAGES_QUERY,
        {
          offset,
          limit: PAGE_SIZE,
          // Filter by parent-video updatedAt. Edge: an image touched after
          // its parent video was last touched won't be picked up by this
          // walk on an incremental sync — the `syncVideoImagesByOwnUpdatedAt`
          // supplementary pass below self-heals that case, and a full sync
          // (no `since`) refreshes everything regardless.
          where: since ? { updatedAt: { gte: since } } : undefined,
        },
      )
      rawVideos = result.data?.videos ?? []
    } catch (err) {
      // Per-page error isolation — record, log, advance offset, continue.
      // A single transient Core failure must not break pagination and
      // trigger the full-run soft-delete on an incomplete seenCoreIds set.
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-image.page.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      offset += PAGE_SIZE
      continue
    }
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
      progress.increment(rawVideos.length)
      if (rawVideos.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const images = parsedImages.data
    if (rawVideos.length === 0) break
    // progress.increment below counts videos; setTotal must use the
    // same unit so the progress reporter shows a meaningful ratio.
    progress.setTotal(offset + rawVideos.length)

    try {
      let updated = 0
      let skippedMissingVideo = 0
      const missingVideoSamples: Array<{ imageId: string; videoId: string }> =
        []
      await prisma.$transaction(async (tx) => {
        for (const image of images) {
          if (!image.videoId) continue
          const videoId = videoMap.get(image.videoId)
          if (!videoId) {
            skippedMissingVideo++
            if (missingVideoSamples.length < 5) {
              missingVideoSamples.push({
                imageId: image.id,
                videoId: image.videoId,
              })
            }
            continue
          }
          seenCoreIds.add(image.id)

          await tx.videoImage.upsert(videoImageUpsertArgs(image, videoId))
          updated++
        }
      }, CORE_SYNC_TRANSACTION_OPTIONS)
      stats.updated += updated
      if (skippedMissingVideo > 0) {
        console.warn(
          JSON.stringify({
            event: "core-sync.video-image.skipped-missing-videos",
            offset,
            count: skippedMissingVideo,
            samples: missingVideoSamples,
          }),
        )
      }
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

  // Self-heal pass: catches images touched in Core without their parent
  // video also being touched, which the nested walk above cannot see on
  // an incremental run. No-op on a full sync — the unfiltered nested walk
  // above already covers every image regardless of which `updatedAt`
  // changed.
  if (since) {
    await syncVideoImagesByOwnUpdatedAt({ prisma, videoMap, stats, since })
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

  // Soft-delete only when the pagination walk completed cleanly AND we
  // actually saw rows. A transient mid-pagination empty page (Core hiccup
  // that doesn't throw) would otherwise tombstone every image whose
  // `syncedAt < phaseStartedAt` because the loop breaks on `rawVideos.length
  // < PAGE_SIZE`. Sibling phases (sync-videos, sync-dubs) use the same
  // `seenCoreIds.size > 0` guard.
  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
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
