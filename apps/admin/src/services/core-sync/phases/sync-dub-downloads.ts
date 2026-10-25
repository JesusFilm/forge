// Sync phase: video-dub-downloads
// Depends on: video-dubs

import type { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery, CoreGraphQLError } from "../core-client"
import { CoreDubDownloadSchema } from "../schemas/dub-download"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

export const PAGE_SIZE = 20000
const PAGE_FETCH_CONCURRENCY = 2
const MAX_CONSECUTIVE_PAGE_ERRORS = 5

const DUB_DOWNLOADS_QUERY = `
  query VideoVariantDownloads(
    $offset: Int!
    $limit: Int!
    $where: VideoVariantDownloadsFilter
  ) {
    videoVariantDownloads(offset: $offset, limit: $limit, where: $where) {
      id
      updatedAt
      videoVariantId
      quality
      size
      height
      width
      bitrate
      url
    }
  }
`

type CoreDubDownload = {
  id: string
  updatedAt: string
  videoVariantId: string | null
  quality: string | null
  size: number | null
  height: number | null
  width: number | null
  bitrate: number | null
  url: string | null
}

type DownloadWrite = {
  id: string
  coreId: string
  videoDubId: string
  quality: string | null
  url: string | null
  size: string | null
  width: string | null
  height: string | null
  bitrate: string | null
}

class DubDownloadSyncBulkWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DubDownloadSyncBulkWriteError"
  }
}

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

function assertDownloadWriteLengths(downloads: readonly DownloadWrite[]) {
  assertParallelArrayLengthsMatch(
    downloads.length,
    [
      { name: "ids", length: downloads.length },
      { name: "coreIds", length: downloads.length },
      { name: "videoDubIds", length: downloads.length },
      { name: "qualities", length: downloads.length },
      { name: "urls", length: downloads.length },
      { name: "sizes", length: downloads.length },
      { name: "widths", length: downloads.length },
      { name: "heights", length: downloads.length },
      { name: "bitrates", length: downloads.length },
    ],
    (message) => new DubDownloadSyncBulkWriteError(message),
  )
}

async function bulkUpsertDownloads(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  downloads: readonly DownloadWrite[],
  { refreshUnchangedRows }: { refreshUnchangedRows: boolean },
) {
  if (downloads.length === 0) return 0

  assertDownloadWriteLengths(downloads)

  return tx.$executeRaw`
    INSERT INTO "video_dub_download" (
      "id",
      "core_id",
      "source",
      "video_dub_id",
      "quality",
      "url",
      "size",
      "width",
      "height",
      "bitrate",
      "synced_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."video_dub_id",
      input."quality",
      input."url",
      input."size_text"::bigint,
      input."width_text"::int,
      input."height_text"::int,
      input."bitrate_text"::int,
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(downloads.map((download) => download.id))}::text[],
      ${toPgArray(downloads.map((download) => download.coreId))}::text[],
      ${toPgArray(downloads.map((download) => download.videoDubId))}::text[],
      ${toPgArray(downloads.map((download) => download.quality))}::text[],
      ${toPgArray(downloads.map((download) => download.url))}::text[],
      ${toPgArray(downloads.map((download) => download.size))}::text[],
      ${toPgArray(downloads.map((download) => download.width))}::text[],
      ${toPgArray(downloads.map((download) => download.height))}::text[],
      ${toPgArray(downloads.map((download) => download.bitrate))}::text[]
    ) AS input(
      "id",
      "core_id",
      "video_dub_id",
      "quality",
      "url",
      "size_text",
      "width_text",
      "height_text",
      "bitrate_text"
    )
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "video_dub_id" = EXCLUDED."video_dub_id",
      "quality"      = EXCLUDED."quality",
      "url"          = EXCLUDED."url",
      "size"         = EXCLUDED."size",
      "width"        = EXCLUDED."width",
      "height"       = EXCLUDED."height",
      "bitrate"      = EXCLUDED."bitrate",
      "synced_at"    = EXCLUDED."synced_at",
      "updated_at"   = EXCLUDED."updated_at",
      "deleted_at"   = NULL
    WHERE
      ${refreshUnchangedRows}::boolean
      OR "video_dub_download"."deleted_at" IS NOT NULL
      OR "video_dub_download"."video_dub_id" IS DISTINCT FROM EXCLUDED."video_dub_id"
      OR "video_dub_download"."quality" IS DISTINCT FROM EXCLUDED."quality"
      OR "video_dub_download"."url" IS DISTINCT FROM EXCLUDED."url"
      OR "video_dub_download"."size" IS DISTINCT FROM EXCLUDED."size"
      OR "video_dub_download"."width" IS DISTINCT FROM EXCLUDED."width"
      OR "video_dub_download"."height" IS DISTINCT FROM EXCLUDED."height"
      OR "video_dub_download"."bitrate" IS DISTINCT FROM EXCLUDED."bitrate"
  `
}

export async function syncDubDownloads({
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

  const dubs = await prisma.videoDub.findMany({
    select: { id: true, coreId: true },
  })
  const dubMap = new Map(dubs.map((dub) => [dub.coreId, dub.id]))

  let offset = 0
  let firstPageWasEmpty = false
  let consecutivePageErrors = 0

  const input = since ? { updatedAt: { gte: since } } : undefined
  async function fetchDownloadPage(pageOffset: number) {
    try {
      const result = await coreQuery<{
        videoVariantDownloads: CoreDubDownload[]
      }>(DUB_DOWNLOADS_QUERY, {
        offset: pageOffset,
        limit: PAGE_SIZE,
        where: input,
      })
      return {
        offset: pageOffset,
        rawDownloads: result.data?.videoVariantDownloads ?? [],
      }
    } catch (err) {
      return { offset: pageOffset, error: err }
    }
  }

  async function processDownloadPage(
    rawDownloads: CoreDubDownload[],
    pageOffset: number,
  ) {
    const parsedDownloads =
      CoreDubDownloadSchema.array().safeParse(rawDownloads)
    if (!parsedDownloads.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub-download.parse-error",
          offset: pageOffset,
          issues: parsedDownloads.error.issues,
        }),
      )
      progress.increment(rawDownloads.length)
      return
    }

    const downloads = parsedDownloads.data
    progress.setTotal(pageOffset + downloads.length)

    const writes = downloads.flatMap((download): DownloadWrite[] => {
      if (!download.videoVariantId) return []
      const videoDubId = dubMap.get(download.videoVariantId)
      if (!videoDubId) return []
      return [
        {
          id: randomUUID(),
          coreId: download.id,
          videoDubId,
          quality: download.quality,
          url: download.url,
          size: download.size == null ? null : String(download.size),
          width: download.width == null ? null : String(download.width),
          height: download.height == null ? null : String(download.height),
          bitrate: download.bitrate == null ? null : String(download.bitrate),
        },
      ]
    })

    try {
      await prisma.$transaction(async (tx) => {
        await bulkUpsertDownloads(tx, writes, {
          refreshUnchangedRows: !since,
        })
      }, CORE_SYNC_TRANSACTION_OPTIONS)
      stats.updated += writes.length
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-dub-download.error",
          offset: pageOffset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(downloads.length)
  }

  while (true) {
    const pageResults = await Promise.all(
      Array.from({ length: PAGE_FETCH_CONCURRENCY }, (_, index) =>
        fetchDownloadPage(offset + index * PAGE_SIZE),
      ),
    )

    let shouldStop = false
    for (const pageResult of pageResults) {
      if ("error" in pageResult) {
        stats.errors++
        consecutivePageErrors++
        console.error(
          JSON.stringify({
            event: "core-sync.video-dub-download.page.error",
            offset: pageResult.offset,
            pageSize: PAGE_SIZE,
            consecutivePageErrors,
            error: describeCoreError(pageResult.error),
          }),
        )
        if (consecutivePageErrors >= MAX_CONSECUTIVE_PAGE_ERRORS) {
          shouldStop = true
          break
        }
        continue
      }

      consecutivePageErrors = 0
      const { rawDownloads } = pageResult

      if (pageResult.offset === 0 && rawDownloads.length === 0) {
        firstPageWasEmpty = true
      }
      if (rawDownloads.length === 0) {
        shouldStop = true
        break
      }

      await processDownloadPage(rawDownloads, pageResult.offset)

      if (rawDownloads.length < PAGE_SIZE) {
        shouldStop = true
        break
      }
    }

    if (shouldStop) break
    offset += PAGE_SIZE * PAGE_FETCH_CONCURRENCY
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-dub-download.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0) {
    const result = await prisma.videoDubDownload.updateMany({
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
