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

const CORE_IMAGE_IDS_QUERY = `
  query CoreImageIds($offset: Int!, $limit: Int!) {
    videos(offset: $offset, limit: $limit) {
      id
      images {
        id
      }
    }
  }
`

type CoreVideoWithImageIds = {
  id: string
  images: Array<{ id: string }>
}

class VideoImageInventoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoImageInventoryError"
  }
}

/**
 * Walks Core's full `videos { id images { id } }` surface and returns the
 * complete set of Core image ids. Used by the coverage audit (#2912), not by
 * this sync phase. Throws rather than returning a partial set: a page error
 * or an empty walk means the inventory is not trustworthy.
 */
export async function fetchCoreImageIdSet(): Promise<{ ids: Set<string> }> {
  const ids = new Set<string>()
  let offset = 0

  while (true) {
    const result = await coreQuery<{ videos: CoreVideoWithImageIds[] }>(
      CORE_IMAGE_IDS_QUERY,
      { offset, limit: PAGE_SIZE },
    )
    const rawVideos = result.data?.videos
    if (!rawVideos) {
      throw new VideoImageInventoryError(
        `Core image inventory page at offset ${offset} returned no data`,
      )
    }

    for (const video of rawVideos) {
      for (const image of video.images) {
        ids.add(image.id)
      }
    }

    if (rawVideos.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (ids.size === 0) {
    throw new VideoImageInventoryError(
      "Core image inventory walk returned no images",
    )
  }

  return { ids }
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
    select: {
      id: true,
      coreId: true,
      images: {
        where: { deletedAt: null },
        select: { coreId: true, coreUpdatedAt: true },
      },
    },
  })
  const videoMap = new Map(videos.map((video) => [video.coreId, video.id]))
  // Keyed by the image's Core id. Only active (non-deleted) rows are
  // represented — a missing entry means "no active row", which always
  // triggers an upsert (covers both brand-new images and reviving a
  // soft-deleted one).
  const existingCoreUpdatedAtMap = new Map<string, Date | null>()
  for (const video of videos) {
    for (const image of video.images ?? []) {
      if (image.coreId)
        existingCoreUpdatedAtMap.set(image.coreId, image.coreUpdatedAt)
    }
  }

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
          // No `where` filter — every run (incremental or full) walks the
          // full catalogue. Filtering by the parent video's `updatedAt`
          // missed images edited after their parent video was last touched;
          // per-image freshness is now decided below via `coreUpdatedAt`.
          where: undefined,
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

          // Upsert only when Admin has no active row for this image, or the
          // stored `coreUpdatedAt` is null or older than Core's `updatedAt`.
          // Unchanged rows cost a Core read but no DB write.
          const hasActiveRow = existingCoreUpdatedAtMap.has(image.id)
          const existingCoreUpdatedAt = existingCoreUpdatedAtMap.get(image.id)
          const incomingCoreUpdatedAt = new Date(image.updatedAt)
          const shouldUpsert =
            !hasActiveRow ||
            existingCoreUpdatedAt == null ||
            existingCoreUpdatedAt < incomingCoreUpdatedAt
          if (!shouldUpsert) continue

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
              coreUpdatedAt: incomingCoreUpdatedAt,
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
              coreUpdatedAt: incomingCoreUpdatedAt,
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
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
