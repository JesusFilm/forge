// Sync phase: video-subtitles
// Depends on: videos, languages, video-editions
//
// Core exposes subtitles as a first-class flat entity. Use that table-shaped
// surface for both incremental updates and full repair, then authorize deletes
// only from a verified full Core id inventory.

import type { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery, CoreGraphQLError } from "../core-client"
import { CoreVideoSubtitleSchema } from "../schemas/video-subtitle"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

export const PAGE_SIZE = 500

const VIDEO_SUBTITLES_QUERY = `
  query VideoSubtitles($offset: Int!, $limit: Int!, $where: VideoSubtitlesFilter) {
    videoSubtitles(offset: $offset, limit: $limit, where: $where) {
      id
      videoId
      languageId
      primary
      edition
      vttSrc
      srtSrc
      value
      updatedAt
      videoEdition { id }
    }
  }
`

const VIDEO_SUBTITLE_IDS_QUERY = `
  query VideoSubtitleIds($offset: Int!, $limit: Int!) {
    videoSubtitlesCount
    videoSubtitles(offset: $offset, limit: $limit) {
      id
    }
  }
`

type CoreSubtitleRaw = {
  id: string
  videoId: string
  languageId: string
  primary: boolean
  edition: string
  vttSrc: string | null
  srtSrc: string | null
  value: string
  updatedAt?: string
  videoEdition: { id: string }
}

type CoreSubtitleIdRow = {
  id: string
}

type SubtitleWrite = {
  id: string
  coreId: string
  videoId: string
  videoEditionId: string
  languageId: string | null
  value: string
  primary: string
  vttSrc: string | null
  srtSrc: string | null
  updatedAt: string
}

class VideoSubtitleSyncBulkWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoSubtitleSyncBulkWriteError"
  }
}

class VideoSubtitleInventoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoSubtitleInventoryError"
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

function assertSubtitleWriteLengths(subtitles: readonly SubtitleWrite[]) {
  assertParallelArrayLengthsMatch(
    subtitles.length,
    [
      { name: "ids", length: subtitles.length },
      { name: "coreIds", length: subtitles.length },
      { name: "videoIds", length: subtitles.length },
      { name: "videoEditionIds", length: subtitles.length },
      { name: "languageIds", length: subtitles.length },
      { name: "values", length: subtitles.length },
      { name: "primaryValues", length: subtitles.length },
      { name: "vttSrcs", length: subtitles.length },
      { name: "srtSrcs", length: subtitles.length },
      { name: "updatedAtValues", length: subtitles.length },
    ],
    (message) => new VideoSubtitleSyncBulkWriteError(message),
  )
}

async function bulkUpsertVideoSubtitles(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  subtitles: readonly SubtitleWrite[],
  { refreshUnchangedRows }: { refreshUnchangedRows: boolean },
) {
  if (subtitles.length === 0) return 0

  assertSubtitleWriteLengths(subtitles)

  return tx.$executeRaw`
    INSERT INTO "video_subtitle" (
      "id",
      "core_id",
      "source",
      "video_id",
      "video_edition_id",
      "language_id",
      "value",
      "primary",
      "vtt_src",
      "srt_src",
      "ai_generated",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."video_id",
      input."video_edition_id",
      input."language_id",
      input."value",
      input."primary_text"::boolean,
      input."vtt_src",
      input."srt_src",
      false,
      NOW(),
      NOW(),
      input."updated_at_text"::timestamptz
    FROM unnest(
      ${toPgArray(subtitles.map((subtitle) => subtitle.id))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.coreId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.videoId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.videoEditionId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.languageId))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.value))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.primary))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.vttSrc))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.srtSrc))}::text[],
      ${toPgArray(subtitles.map((subtitle) => subtitle.updatedAt))}::text[]
    ) AS input(
      "id",
      "core_id",
      "video_id",
      "video_edition_id",
      "language_id",
      "value",
      "primary_text",
      "vtt_src",
      "srt_src",
      "updated_at_text"
    )
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "video_id"         = EXCLUDED."video_id",
      "video_edition_id" = EXCLUDED."video_edition_id",
      "language_id"      = EXCLUDED."language_id",
      "value"            = EXCLUDED."value",
      "primary"          = EXCLUDED."primary",
      "vtt_src"          = EXCLUDED."vtt_src",
      "srt_src"          = EXCLUDED."srt_src",
      "synced_at"        = EXCLUDED."synced_at",
      "updated_at"       = EXCLUDED."updated_at",
      "deleted_at"       = NULL
    WHERE
      ${refreshUnchangedRows}::boolean
      OR "video_subtitle"."deleted_at" IS NOT NULL
      OR "video_subtitle"."video_id" IS DISTINCT FROM EXCLUDED."video_id"
      OR "video_subtitle"."video_edition_id" IS DISTINCT FROM EXCLUDED."video_edition_id"
      OR "video_subtitle"."language_id" IS DISTINCT FROM EXCLUDED."language_id"
      OR "video_subtitle"."value" IS DISTINCT FROM EXCLUDED."value"
      OR "video_subtitle"."primary" IS DISTINCT FROM EXCLUDED."primary"
      OR "video_subtitle"."vtt_src" IS DISTINCT FROM EXCLUDED."vtt_src"
      OR "video_subtitle"."srt_src" IS DISTINCT FROM EXCLUDED."srt_src"
      OR "video_subtitle"."updated_at" IS DISTINCT FROM EXCLUDED."updated_at"
  `
}

async function loadActiveAdminCoreSubtitleIds(
  prisma: Pick<PrismaClient, "videoSubtitle">,
): Promise<Set<string>> {
  const rows = await prisma.videoSubtitle.findMany({
    where: { source: "CORE", deletedAt: null, coreId: { not: null } },
    select: { coreId: true },
  })
  return new Set(rows.flatMap((row) => (row.coreId ? [row.coreId] : [])))
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  const result = new Set<string>()
  for (const value of left) {
    if (!right.has(value)) result.add(value)
  }
  return result
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

async function fetchCoreSubtitleIdSet(): Promise<{
  ids: Set<string>
  count: number
}> {
  const ids = new Set<string>()
  let expectedCount: number | null = null
  let offset = 0

  while (true) {
    const result = await coreQuery<{
      videoSubtitlesCount: number
      videoSubtitles: CoreSubtitleIdRow[]
    }>(VIDEO_SUBTITLE_IDS_QUERY, { offset, limit: PAGE_SIZE })

    const count = result.data?.videoSubtitlesCount
    const rows = result.data?.videoSubtitles ?? []
    if (typeof count !== "number") {
      throw new VideoSubtitleInventoryError("Core subtitle count is missing")
    }
    expectedCount ??= count
    if (expectedCount !== count) {
      throw new VideoSubtitleInventoryError(
        "Core subtitle count changed during inventory scan",
      )
    }

    for (const row of rows) {
      if (ids.has(row.id)) {
        throw new VideoSubtitleInventoryError(
          `Duplicate Core subtitle id in inventory: ${row.id}`,
        )
      }
      ids.add(row.id)
    }

    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (expectedCount === null) {
    throw new VideoSubtitleInventoryError("Core subtitle inventory was empty")
  }
  if (ids.size !== expectedCount) {
    throw new VideoSubtitleInventoryError(
      `Core subtitle inventory count mismatch: expected ${expectedCount}, got ${ids.size}`,
    )
  }

  return { ids, count: expectedCount }
}

async function fetchStableCoreSubtitleInventory(): Promise<{
  ids: Set<string>
  count: number
}> {
  const first = await fetchCoreSubtitleIdSet()
  const second = await fetchCoreSubtitleIdSet()
  if (first.count !== second.count || !sameSet(first.ids, second.ids)) {
    throw new VideoSubtitleInventoryError(
      "Core subtitle inventory changed between verification reads",
    )
  }
  if (first.ids.size === 0) {
    throw new VideoSubtitleInventoryError(
      "Refusing subtitle delete authority from an empty Core inventory",
    )
  }
  return first
}

export async function syncVideoSubtitles({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  const [videos, languages, editions] = await Promise.all([
    prisma.video.findMany({ select: { id: true, coreId: true } }),
    prisma.language.findMany({ select: { id: true, coreId: true } }),
    prisma.videoEdition.findMany({ select: { id: true, coreId: true } }),
  ])
  const videoMap = new Map(videos.map((video) => [video.coreId, video.id]))
  const langMap = new Map(
    languages.map((language) => [language.coreId, language.id]),
  )
  const editionMap = new Map(
    editions.map((edition) => [edition.coreId, edition.id]),
  )

  async function processSubtitlePage(
    rawSubtitles: CoreSubtitleRaw[],
    pageOffset: number,
    { refreshUnchangedRows }: { refreshUnchangedRows: boolean },
  ) {
    const parsedSubtitles =
      CoreVideoSubtitleSchema.array().safeParse(rawSubtitles)
    if (!parsedSubtitles.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-subtitle.parse-error",
          offset: pageOffset,
          issues: parsedSubtitles.error.issues,
        }),
      )
      progress.increment(rawSubtitles.length)
      return
    }

    const subtitles = parsedSubtitles.data
    if (subtitles.length === 0) return

    progress.setTotal(pageOffset + subtitles.length)

    try {
      let pageUpdated = 0
      let pageSkippedMissingParent = 0
      let pageSkippedManagerOwned = 0
      const missingParentSamples: Array<{
        subtitleId: string
        videoId: string
        videoEditionId: string
      }> = []

      await prisma.$transaction(async (tx) => {
        const existingSubtitles = await tx.videoSubtitle.findMany({
          where: { coreId: { in: subtitles.map((subtitle) => subtitle.id) } },
          select: { coreId: true, source: true },
        })
        const managerOwnedCoreIds = new Set(
          existingSubtitles
            .filter((subtitle) => subtitle.source === "MANAGER")
            .map((subtitle) => subtitle.coreId)
            .filter((coreId): coreId is string => coreId != null),
        )

        const writes: SubtitleWrite[] = []
        for (const subtitle of subtitles) {
          if (managerOwnedCoreIds.has(subtitle.id)) {
            pageSkippedManagerOwned++
            continue
          }

          const videoId = videoMap.get(subtitle.videoId)
          const videoEditionId = editionMap.get(subtitle.videoEdition.id)
          if (!videoId || !videoEditionId) {
            pageSkippedMissingParent++
            if (missingParentSamples.length < 5) {
              missingParentSamples.push({
                subtitleId: subtitle.id,
                videoId: subtitle.videoId,
                videoEditionId: subtitle.videoEdition.id,
              })
            }
            continue
          }

          const updatedAt = subtitle.updatedAt
            ? new Date(subtitle.updatedAt)
            : new Date()

          writes.push({
            id: randomUUID(),
            coreId: subtitle.id,
            videoId,
            videoEditionId,
            languageId: langMap.get(subtitle.languageId) ?? null,
            value: subtitle.value,
            primary: String(subtitle.primary),
            vttSrc: subtitle.vttSrc,
            srtSrc: subtitle.srtSrc,
            updatedAt: updatedAt.toISOString(),
          })
        }

        await bulkUpsertVideoSubtitles(tx, writes, { refreshUnchangedRows })
        pageUpdated += writes.length
      }, CORE_SYNC_TRANSACTION_OPTIONS)

      stats.updated += pageUpdated
      if (pageSkippedMissingParent > 0) {
        stats.errors++
        console.warn(
          JSON.stringify({
            event: "core-sync.video-subtitle.skipped-missing-parent",
            offset: pageOffset,
            count: pageSkippedMissingParent,
            samples: missingParentSamples,
          }),
        )
      }
      if (pageSkippedManagerOwned > 0) {
        console.warn(
          JSON.stringify({
            event: "core-sync.video-subtitle.skipped-manager-owned",
            offset: pageOffset,
            count: pageSkippedManagerOwned,
          }),
        )
      }
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-subtitle.error",
          offset: pageOffset,
          error: describeCoreError(err),
        }),
      )
    }

    progress.increment(subtitles.length)
  }

  async function fetchAndUpsertSubtitleRows({
    where,
    refreshUnchangedRows,
  }: {
    where?: { updatedAt: { gte: string } }
    refreshUnchangedRows: boolean
  }) {
    let offset = 0
    while (true) {
      let rawSubtitles: CoreSubtitleRaw[] = []
      try {
        const result = await coreQuery<{ videoSubtitles: CoreSubtitleRaw[] }>(
          VIDEO_SUBTITLES_QUERY,
          { offset, limit: PAGE_SIZE, where },
        )
        rawSubtitles = result.data?.videoSubtitles ?? []
      } catch (err) {
        stats.errors++
        console.error(
          JSON.stringify({
            event: "core-sync.video-subtitle.page.error",
            offset,
            pageSize: PAGE_SIZE,
            error: describeCoreError(err),
          }),
        )
        return
      }

      if (rawSubtitles.length === 0) break
      await processSubtitlePage(rawSubtitles, offset, { refreshUnchangedRows })
      if (rawSubtitles.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }

  let fullRepairAttempted = false

  if (since) {
    await fetchAndUpsertSubtitleRows({
      where: { updatedAt: { gte: since } },
      refreshUnchangedRows: false,
    })
  } else {
    fullRepairAttempted = true
    await fetchAndUpsertSubtitleRows({ refreshUnchangedRows: true })
  }

  if (stats.errors > 0) return stats

  let inventory: { ids: Set<string>; count: number }
  try {
    inventory = await fetchStableCoreSubtitleInventory()
  } catch (err) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.video-subtitle.inventory.error",
        error: describeCoreError(err),
      }),
    )
    return stats
  }

  let activeAdminIds = await loadActiveAdminCoreSubtitleIds(prisma)
  const missingAdminIds = difference(inventory.ids, activeAdminIds)

  if (missingAdminIds.size > 0 && !fullRepairAttempted) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-subtitle.full-repair-started",
        missingCount: missingAdminIds.size,
        coreCount: inventory.count,
      }),
    )
    fullRepairAttempted = true
    await fetchAndUpsertSubtitleRows({ refreshUnchangedRows: true })
    if (stats.errors > 0) return stats
    try {
      inventory = await fetchStableCoreSubtitleInventory()
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-subtitle.inventory.error",
          error: describeCoreError(err),
        }),
      )
      return stats
    }
    activeAdminIds = await loadActiveAdminCoreSubtitleIds(prisma)
  }

  const remainingMissingAdminIds = difference(inventory.ids, activeAdminIds)
  if (remainingMissingAdminIds.size > 0) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.video-subtitle.full-repair-incomplete",
        missingCount: remainingMissingAdminIds.size,
        sampleIds: Array.from(remainingMissingAdminIds).slice(0, 10),
      }),
    )
    return stats
  }

  try {
    const result = await prisma.$executeRaw`
      UPDATE "video_subtitle"
      SET "deleted_at" = NOW()
      WHERE "source" = 'core'::"SourceTier"
        AND "deleted_at" IS NULL
        AND "core_id" IS NOT NULL
        AND NOT ("core_id" = ANY(${toPgArray(Array.from(inventory.ids))}::text[]))
    `
    stats.softDeleted += Number(result)
  } catch (err) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.video-subtitle.soft-delete.error",
        error: describeCoreError(err),
      }),
    )
  }

  return stats
}
