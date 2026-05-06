// Sync phase: video-dubs (formerly video-variants in Core)
//
// Boundary translation: Core's `videoVariant` → admin's `VideoDub`.
// The varying axis is the audio language (a dub), not the frames.
// Depends on: videos, languages

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery, CoreGraphQLError } from "../core-client"
import { CoreDubSchema } from "../schemas/dub"
import { emptySyncStats } from "../types"
import { toPgArray } from "@/db/pgvector"

// Page size sized to Core's resolver fan-out budget, not to client-side
// throughput. Exported so the test suite can size full-page mocks against
// the same constant — a hard-coded literal in the test silently degrades
// into a single-page case the moment this value moves.
// See `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
export const PAGE_SIZE = 100

// Circuit-breaker for the page loop. Without this guard a hard Core
// outage causes the loop to advance `offset` indefinitely, retry-storm
// Core every PAGE_SIZE pages, and pin a worker. We trip after this many
// consecutive page-fetch failures with a structured log event.
const MAX_CONSECUTIVE_PAGE_ERRORS = 5

function describeCoreError(
  err: unknown,
):
  | { name: string; message: string; errors?: unknown }
  | { name: string; message: string }
  | { message: string } {
  if (err instanceof CoreGraphQLError) {
    return {
      name: err.name,
      message: err.message,
      errors: err.errors.map((detail) => ({
        message: detail.message,
        path: detail.path,
        code: detail.extensions?.code,
      })),
    }
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message }
  }
  return { message: String(err) }
}

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
      brightcoveId
      updatedAt
      language { id }
      videoEdition { id name }
      muxVideo { id assetId playbackId }
      downloads {
        id
        quality
        size
        height
        width
        bitrate
        url
      }
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
  brightcoveId: string | null
  videoEdition: { id: string; name: string | null } | null
  muxVideo: {
    id: string
    assetId: string | null
    playbackId: string | null
  } | null
  downloads: Array<{
    id: string
    quality: string | null
    size: string | number | null
    height: number | null
    width: number | null
    bitrate: number | null
    url: string | null
  }>
  updatedAt?: string
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

  let offset = 0
  let firstPageWasEmpty = false
  let consecutivePageErrors = 0
  const seenCoreIds = new Set<string>()

  async function processVariantPage(
    rawVariants: CoreVariant[],
    pageOffset: number,
  ) {
    const parsedVariants = CoreDubSchema.array().safeParse(rawVariants)
    if (!parsedVariants.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.parse-error",
          offset: pageOffset,
          issues: parsedVariants.error.issues,
        }),
      )
      progress.increment(rawVariants.length)
      return
    }

    const variants = parsedVariants.data
    if (variants.length === 0) return

    progress.setTotal(pageOffset + variants.length)

    try {
      let pageUpdated = 0
      let pageSkippedMissingVideo = 0
      const missingVideoSamples: Array<{ dubId: string; videoId: string }> = []
      await prisma.$transaction(
        async (tx) => {
          for (const variant of variants) {
            const videoId = videoMap.get(variant.videoId)
            if (!videoId) {
              pageSkippedMissingVideo++
              if (missingVideoSamples.length < 5) {
                missingVideoSamples.push({
                  dubId: variant.id,
                  videoId: variant.videoId,
                })
              }
              continue
            }

            if (!since) {
              seenCoreIds.add(variant.id)
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
            let videoEditionId: string | undefined
            if (variant.videoEdition) {
              const edition = await tx.videoEdition.upsert({
                where: { coreId: variant.videoEdition.id },
                create: {
                  coreId: variant.videoEdition.id,
                  name: variant.videoEdition.name ?? "",
                  syncedAt: new Date(),
                },
                update: {
                  name: variant.videoEdition.name ?? "",
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
              videoEditionId = edition.id
            }
            let muxVideoId: string | undefined
            if (variant.muxVideo) {
              const muxVideo = await tx.muxVideo.upsert({
                where: { coreId: variant.muxVideo.id },
                create: {
                  coreId: variant.muxVideo.id,
                  assetId: variant.muxVideo.assetId,
                  playbackId: variant.muxVideo.playbackId,
                  syncedAt: new Date(),
                },
                update: {
                  assetId: variant.muxVideo.assetId,
                  playbackId: variant.muxVideo.playbackId,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
              muxVideoId = muxVideo.id
            }

            const updatedAt = variant.updatedAt
              ? new Date(variant.updatedAt)
              : new Date()

            const dub = await tx.videoDub.upsert({
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
                brightcoveId: variant.brightcoveId,
                source: "CORE",
                languageId,
                videoEditionId: videoEditionId ?? null,
                muxVideoId: muxVideoId ?? null,
                updatedAt,
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
                brightcoveId: variant.brightcoveId,
                languageId,
                videoEditionId: videoEditionId ?? null,
                muxVideoId: muxVideoId ?? null,
                updatedAt,
                syncedAt: new Date(),
                deletedAt: null,
              },
            })

            const seenDownloadIds = new Set(
              variant.downloads.map((download) => download.id),
            )
            for (const download of variant.downloads) {
              await tx.videoDubDownload.upsert({
                where: { coreId: download.id },
                create: {
                  coreId: download.id,
                  videoDubId: dub.id,
                  quality: download.quality,
                  url: download.url,
                  size: download.size == null ? null : BigInt(download.size),
                  width: download.width,
                  height: download.height,
                  bitrate: download.bitrate,
                  syncedAt: new Date(),
                },
                update: {
                  videoDubId: dub.id,
                  quality: download.quality,
                  url: download.url,
                  size: download.size == null ? null : BigInt(download.size),
                  width: download.width,
                  height: download.height,
                  bitrate: download.bitrate,
                  syncedAt: new Date(),
                  deletedAt: null,
                },
              })
            }
            await tx.videoDubDownload.updateMany({
              where: {
                videoDubId: dub.id,
                source: "CORE",
                coreId: { notIn: [...seenDownloadIds] },
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            })
            pageUpdated++
          }
        },
        { timeout: 60_000, maxWait: 5_000 },
      )
      stats.updated += pageUpdated
      if (pageSkippedMissingVideo > 0) {
        console.warn(
          JSON.stringify({
            event: "core-sync.video-dub.skipped-missing-videos",
            offset: pageOffset,
            count: pageSkippedMissingVideo,
            samples: missingVideoSamples,
          }),
        )
      }
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.error",
          offset: pageOffset,
          error: describeCoreError(err),
        }),
      )
    }

    progress.increment(variants.length)
  }

  const variantsInput = since ? { updatedAt: { gte: since } } : undefined
  while (true) {
    let rawVariants: CoreVariant[] = []
    try {
      const result = await coreQuery<{ videoVariants: CoreVariant[] }>(
        DUBS_QUERY,
        {
          offset,
          limit: PAGE_SIZE,
          input: variantsInput,
        },
      )
      rawVariants = result.data?.videoVariants ?? []
      consecutivePageErrors = 0
    } catch (err) {
      stats.errors++
      consecutivePageErrors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.page.error",
          offset,
          pageSize: PAGE_SIZE,
          consecutivePageErrors,
          error: describeCoreError(err),
        }),
      )
      if (consecutivePageErrors >= MAX_CONSECUTIVE_PAGE_ERRORS) {
        console.error(
          JSON.stringify({
            event: "core-sync.video-dub.aborted-too-many-errors",
            offset,
            consecutivePageErrors,
            threshold: MAX_CONSECUTIVE_PAGE_ERRORS,
          }),
        )
        break
      }
      offset += PAGE_SIZE
      continue
    }

    if (offset === 0 && rawVariants.length === 0) {
      firstPageWasEmpty = true
    }

    if (rawVariants.length === 0) break

    await processVariantPage(rawVariants, offset)

    if (rawVariants.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-dub.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    // Soft-delete via array-bound raw SQL, NOT
    // `prisma.videoDub.updateMany({ coreId: { notIn: [...] } })`. The
    // `notIn` translation emits one prepared-statement parameter per
    // ID, and Postgres caps that at 32,767 (PG_INT16_MAX). On a 200k+
    // dub catalogue the cleanup tail throws "too many bind variables
    // in prepared statement, expected maximum of 32767" and aborts.
    // Binding the seen-id set as a single PG array literal keeps the
    // parameter count at 1 regardless of catalogue size. Per
    // docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md.
    //
    // Enum literal note: `'core'` is the lowercase DB value for
    // `SourceTier` (see `0001_init` line 27 — `('core','manager')`).
    // Prisma's TS enum maps `CORE` → `'core'` automatically; raw SQL
    // bypasses that mapping so the literal must match the DB value.
    const seenIdsLiteral = toPgArray(Array.from(seenCoreIds))
    try {
      const affected = await prisma.$executeRaw`
        UPDATE "video_dub"
        SET    "deleted_at" = NOW()
        WHERE  "source"     = 'core'
          AND  "deleted_at" IS NULL
          AND  NOT ("core_id" = ANY(${seenIdsLiteral}::text[]))
      `
      stats.softDeleted += affected
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.soft-delete.error",
          seenCount: seenCoreIds.size,
          error: describeCoreError(err),
        }),
      )
    }
  }

  return stats
}
