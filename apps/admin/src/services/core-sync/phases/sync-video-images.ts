// Sync phase: video-images
// Depends on: videos
//
// Data source rationale: this phase walks Core's
// `adminVideos(...) { images { ... } }` nested field rather than the flat
// `videoImages(...)` list. The flat list is
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

// A page failure that is permanent rather than transient — Core rejecting the
// publisher root field for a caller it does not consider a publisher, say —
// would otherwise spin the pagination loop below forever: the per-page catch
// records the error, advances `offset` and continues, and the loop's only exit
// is a short page it will never receive. Bounding consecutive failures ends the
// phase with `errors > 0`, which suppresses the soft-delete and stops the
// orchestrator advancing the watermark, instead of hanging the whole sync job.
const MAX_CONSECUTIVE_PAGE_ERRORS = 3

// Reads Core's publisher root field for the same reason the catalogue phase
// does (JesusFilm/forge#2324): the public `videos` field hides every video
// restricted from the caller's own client name, so a Watch-restricted video
// reached this phase with no images at all — and the full-sync soft-delete
// then tombstoned the images it already had.
const VIDEOS_WITH_IMAGES_QUERY = `
  query AdminVideosWithImages($offset: Int!, $limit: Int!, $where: VideosFilter) {
    adminVideos(offset: $offset, limit: $limit, where: $where) {
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
  let consecutivePageErrors = 0

  while (true) {
    let rawVideos: CoreVideoWithImages[] = []
    try {
      const result = await coreQuery<{ adminVideos: CoreVideoWithImages[] }>(
        VIDEOS_WITH_IMAGES_QUERY,
        {
          offset,
          limit: PAGE_SIZE,
          where: {
            // The public `videos` field filtered to published videos
            // implicitly; `adminVideos` does not, so this phase has to say so.
            // Without it the walk would start importing images for Core drafts
            // that the catalogue phase never creates a Video row for — every
            // one of them a wasted page, and `videoMap` misses for all of them.
            // Matches the catalogue phase's own `published: true`.
            published: true,
            // Filter by parent-video updatedAt. Edge: an image touched after
            // its parent video was last touched won't be picked up by an
            // incremental sync until the next full sync. Acceptable trade-off
            // for the coverage win — full sync (no `since`) refreshes
            // everything regardless.
            ...(since ? { updatedAt: { gte: since } } : {}),
          },
        },
      )
      rawVideos = result.data?.adminVideos ?? []
      consecutivePageErrors = 0
    } catch (err) {
      // Per-page error isolation — record, log, advance offset, continue.
      // A single transient Core failure must not break pagination and
      // trigger the full-run soft-delete on an incomplete seenCoreIds set.
      stats.errors++
      consecutivePageErrors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-image.page.error",
          offset,
          consecutivePageErrors,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      if (consecutivePageErrors >= MAX_CONSECUTIVE_PAGE_ERRORS) {
        console.error(
          JSON.stringify({
            event: "core-sync.video-image.page.error.aborted",
            offset,
            consecutivePageErrors,
            reason: "consecutive_page_errors",
          }),
        )
        break
      }
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
      await prisma.$transaction(async (tx) => {
        for (const image of images) {
          if (!image.videoId) continue
          const videoId = videoMap.get(image.videoId)
          if (!videoId) continue
          seenCoreIds.add(image.id)

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
