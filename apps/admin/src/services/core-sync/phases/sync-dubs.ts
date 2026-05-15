// Sync phase: video-dubs (formerly video-variants in Core)
//
// Boundary translation: Core's `videoVariant` → admin's `VideoDub`.
// The varying axis is the audio language (a dub), not the frames.
// Depends on: videos, languages

import type { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery, CoreGraphQLError } from "../core-client"
import { CoreDubSchema } from "../schemas/dub"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

// Page size sized to Core's resolver fan-out budget, not to client-side
// throughput. Exported so the test suite can size full-page mocks against
// the same constant — a hard-coded literal in the test silently degrades
// into a single-page case the moment this value moves.
// See `docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`.
export const PAGE_SIZE = 10000

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
  updatedAt?: string
}

type DubWrite = {
  id: string
  coreId: string
  videoId: string
  slug: string | null
  duration: string | null
  lengthInMilliseconds: string | null
  hls: string | null
  dash: string | null
  share: string | null
  downloadable: string
  published: string
  brightcoveId: string | null
  languageId: string | null
  videoEditionId: string | null
  muxVideoId: string | null
  updatedAt: string
}

class DubSyncBulkWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DubSyncBulkWriteError"
  }
}

function assertDubWriteLengths(dubs: readonly DubWrite[]) {
  assertParallelArrayLengthsMatch(
    dubs.length,
    [
      { name: "ids", length: dubs.length },
      { name: "coreIds", length: dubs.length },
      { name: "videoIds", length: dubs.length },
      { name: "slugs", length: dubs.length },
      { name: "durations", length: dubs.length },
      { name: "lengths", length: dubs.length },
      { name: "hlsValues", length: dubs.length },
      { name: "dashValues", length: dubs.length },
      { name: "shareValues", length: dubs.length },
      { name: "downloadableValues", length: dubs.length },
      { name: "publishedValues", length: dubs.length },
      { name: "brightcoveIds", length: dubs.length },
      { name: "languageIds", length: dubs.length },
      { name: "videoEditionIds", length: dubs.length },
      { name: "muxVideoIds", length: dubs.length },
      { name: "updatedAtValues", length: dubs.length },
    ],
    (message) => new DubSyncBulkWriteError(message),
  )
}

async function bulkUpsertDubs(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  dubs: readonly DubWrite[],
  { refreshUnchangedRows }: { refreshUnchangedRows: boolean },
) {
  if (dubs.length === 0) return 0

  assertDubWriteLengths(dubs)

  return tx.$executeRaw`
    INSERT INTO "video_dub" (
      "id",
      "core_id",
      "source",
      "video_id",
      "slug",
      "duration",
      "length_in_milliseconds",
      "hls",
      "dash",
      "share",
      "downloadable",
      "published",
      "brightcove_id",
      "language_id",
      "video_edition_id",
      "mux_video_id",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."video_id",
      input."slug",
      input."duration_text"::int,
      input."length_text"::bigint,
      input."hls",
      input."dash",
      input."share",
      input."downloadable_text"::boolean,
      input."published_text"::boolean,
      input."brightcove_id",
      input."language_id",
      input."video_edition_id",
      input."mux_video_id",
      NOW(),
      NOW(),
      input."updated_at_text"::timestamptz
    FROM unnest(
      ${toPgArray(dubs.map((dub) => dub.id))}::text[],
      ${toPgArray(dubs.map((dub) => dub.coreId))}::text[],
      ${toPgArray(dubs.map((dub) => dub.videoId))}::text[],
      ${toPgArray(dubs.map((dub) => dub.slug))}::text[],
      ${toPgArray(dubs.map((dub) => dub.duration))}::text[],
      ${toPgArray(dubs.map((dub) => dub.lengthInMilliseconds))}::text[],
      ${toPgArray(dubs.map((dub) => dub.hls))}::text[],
      ${toPgArray(dubs.map((dub) => dub.dash))}::text[],
      ${toPgArray(dubs.map((dub) => dub.share))}::text[],
      ${toPgArray(dubs.map((dub) => dub.downloadable))}::text[],
      ${toPgArray(dubs.map((dub) => dub.published))}::text[],
      ${toPgArray(dubs.map((dub) => dub.brightcoveId))}::text[],
      ${toPgArray(dubs.map((dub) => dub.languageId))}::text[],
      ${toPgArray(dubs.map((dub) => dub.videoEditionId))}::text[],
      ${toPgArray(dubs.map((dub) => dub.muxVideoId))}::text[],
      ${toPgArray(dubs.map((dub) => dub.updatedAt))}::text[]
    ) AS input(
      "id",
      "core_id",
      "video_id",
      "slug",
      "duration_text",
      "length_text",
      "hls",
      "dash",
      "share",
      "downloadable_text",
      "published_text",
      "brightcove_id",
      "language_id",
      "video_edition_id",
      "mux_video_id",
      "updated_at_text"
    )
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "video_id"                = EXCLUDED."video_id",
      "slug"                    = EXCLUDED."slug",
      "duration"                = EXCLUDED."duration",
      "length_in_milliseconds"  = EXCLUDED."length_in_milliseconds",
      "hls"                     = EXCLUDED."hls",
      "dash"                    = EXCLUDED."dash",
      "share"                   = EXCLUDED."share",
      "downloadable"            = EXCLUDED."downloadable",
      "published"               = EXCLUDED."published",
      "brightcove_id"           = EXCLUDED."brightcove_id",
      "language_id"             = EXCLUDED."language_id",
      "video_edition_id"        = EXCLUDED."video_edition_id",
      "mux_video_id"            = EXCLUDED."mux_video_id",
      "synced_at"               = EXCLUDED."synced_at",
      "updated_at"              = EXCLUDED."updated_at",
      "deleted_at"              = NULL
    WHERE
      ${refreshUnchangedRows}::boolean
      OR "video_dub"."deleted_at" IS NOT NULL
      OR "video_dub"."video_id" IS DISTINCT FROM EXCLUDED."video_id"
      OR "video_dub"."slug" IS DISTINCT FROM EXCLUDED."slug"
      OR "video_dub"."duration" IS DISTINCT FROM EXCLUDED."duration"
      OR "video_dub"."length_in_milliseconds" IS DISTINCT FROM EXCLUDED."length_in_milliseconds"
      OR "video_dub"."hls" IS DISTINCT FROM EXCLUDED."hls"
      OR "video_dub"."dash" IS DISTINCT FROM EXCLUDED."dash"
      OR "video_dub"."share" IS DISTINCT FROM EXCLUDED."share"
      OR "video_dub"."downloadable" IS DISTINCT FROM EXCLUDED."downloadable"
      OR "video_dub"."published" IS DISTINCT FROM EXCLUDED."published"
      OR "video_dub"."brightcove_id" IS DISTINCT FROM EXCLUDED."brightcove_id"
      OR "video_dub"."language_id" IS DISTINCT FROM EXCLUDED."language_id"
      OR "video_dub"."video_edition_id" IS DISTINCT FROM EXCLUDED."video_edition_id"
      OR "video_dub"."mux_video_id" IS DISTINCT FROM EXCLUDED."mux_video_id"
      OR "video_dub"."updated_at" IS DISTINCT FROM EXCLUDED."updated_at"
  `
}

async function bulkUpsertMuxVideos(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  muxVideos: ReadonlyArray<{
    id: string
    coreId: string
    assetId: string | null
    playbackId: string | null
  }>,
) {
  if (muxVideos.length === 0) return new Map<string, string>()

  const rows = await tx.$queryRaw<Array<{ coreId: string; id: string }>>`
    INSERT INTO "mux_video" (
      "id",
      "core_id",
      "source",
      "asset_id",
      "playback_id",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."asset_id",
      input."playback_id",
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(muxVideos.map((muxVideo) => muxVideo.id))}::text[],
      ${toPgArray(muxVideos.map((muxVideo) => muxVideo.coreId))}::text[],
      ${toPgArray(muxVideos.map((muxVideo) => muxVideo.assetId))}::text[],
      ${toPgArray(muxVideos.map((muxVideo) => muxVideo.playbackId))}::text[]
    ) AS input("id", "core_id", "asset_id", "playback_id")
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "asset_id"    = EXCLUDED."asset_id",
      "playback_id" = EXCLUDED."playback_id",
      "synced_at"   = EXCLUDED."synced_at",
      "updated_at"  = EXCLUDED."updated_at",
      "deleted_at"  = NULL
    RETURNING "core_id" AS "coreId", "id"
  `

  return new Map(rows.map((row) => [row.coreId, row.id]))
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
  const phaseStartedAt = new Date()

  const videos = await prisma.video.findMany({
    select: { id: true, coreId: true },
  })
  const videoMap = new Map(videos.map((v) => [v.coreId, v.id]))

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const videoEditions = await prisma.videoEdition.findMany({
    select: { id: true, coreId: true },
  })
  const editionMap = new Map(videoEditions.map((e) => [e.coreId, e.id]))

  let offset = 0
  let firstPageWasEmpty = false
  let consecutivePageErrors = 0

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
      await prisma.$transaction(async (tx) => {
        const existingCoreDubs = await tx.videoDub.findMany({
          where: { coreId: { in: variants.map((variant) => variant.id) } },
          select: { coreId: true, source: true },
        })
        const managerOwnedCoreIds = new Set(
          existingCoreDubs
            .filter((dub) => dub.source === "MANAGER")
            .map((dub) => dub.coreId),
        )
        const pageMuxVideos = new Map<
          string,
          {
            id: string
            coreId: string
            assetId: string | null
            playbackId: string | null
          }
        >()

        for (const variant of variants) {
          if (variant.muxVideo) {
            pageMuxVideos.set(variant.muxVideo.id, {
              id: randomUUID(),
              coreId: variant.muxVideo.id,
              assetId: variant.muxVideo.assetId,
              playbackId: variant.muxVideo.playbackId,
            })
          }
        }
        const muxVideoIdByCoreId = await bulkUpsertMuxVideos(
          tx,
          Array.from(pageMuxVideos.values()),
        )
        const pageDubs: DubWrite[] = []

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

          if (managerOwnedCoreIds.has(variant.id)) {
            continue
          }

          const languageId = variant.language
            ? (langMap.get(variant.language.id) ?? null)
            : null
          const videoEditionId = variant.videoEdition
            ? editionMap.get(variant.videoEdition.id)
            : undefined
          const muxVideoId = variant.muxVideo
            ? muxVideoIdByCoreId.get(variant.muxVideo.id)
            : undefined

          const updatedAt = variant.updatedAt
            ? new Date(variant.updatedAt)
            : new Date()

          pageDubs.push({
            id: randomUUID(),
            coreId: variant.id,
            videoId,
            slug: variant.slug,
            duration: String(variant.duration),
            lengthInMilliseconds: variant.lengthInMilliseconds
              ? String(variant.lengthInMilliseconds)
              : null,
            hls: variant.hls,
            dash: variant.dash,
            share: variant.share,
            downloadable: String(variant.downloadable),
            published: String(variant.published),
            brightcoveId: variant.brightcoveId,
            languageId,
            videoEditionId: videoEditionId ?? null,
            muxVideoId: muxVideoId ?? null,
            updatedAt: updatedAt.toISOString(),
          })
        }

        await bulkUpsertDubs(tx, pageDubs, {
          refreshUnchangedRows: !since,
        })
        pageUpdated += pageDubs.length
      }, CORE_SYNC_TRANSACTION_OPTIONS)
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

  if (!since && stats.errors === 0) {
    try {
      const result = await prisma.videoDub.updateMany({
        where: {
          source: "CORE",
          deletedAt: null,
          OR: [{ syncedAt: null }, { syncedAt: { lt: phaseStartedAt } }],
        },
        data: { deletedAt: new Date() },
      })
      stats.softDeleted += result.count
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub.soft-delete.error",
          error: describeCoreError(err),
        }),
      )
    }
  }

  return stats
}
