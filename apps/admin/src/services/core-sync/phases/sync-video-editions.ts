// Sync phase: video-editions
// Depends on: videos indirectly through downstream dubs/subtitles, but the
// edition catalogue itself is a standalone Core query.

import type { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoEditionSchema } from "../schemas/video-edition"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

const VIDEO_EDITIONS_QUERY = `
  query VideoEditions($offset: Int!, $limit: Int!, $where: VideoEditionsFilter) {
    videoEditions(offset: $offset, limit: $limit, where: $where) {
      id
      name
      updatedAt
    }
  }
`

type CoreVideoEdition = {
  id: string
  name: string | null
  updatedAt?: string
}

type EditionWrite = {
  id: string
  coreId: string
  name: string
}

class VideoEditionSyncBulkWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoEditionSyncBulkWriteError"
  }
}

function assertEditionWriteLengths(editions: readonly EditionWrite[]) {
  assertParallelArrayLengthsMatch(
    editions.length,
    [
      { name: "ids", length: editions.length },
      { name: "coreIds", length: editions.length },
      { name: "names", length: editions.length },
    ],
    (message) => new VideoEditionSyncBulkWriteError(message),
  )
}

async function bulkUpsertVideoEditions(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  editions: readonly EditionWrite[],
) {
  if (editions.length === 0) return 0

  assertEditionWriteLengths(editions)

  return tx.$executeRaw`
    INSERT INTO "video_edition" (
      "id",
      "core_id",
      "source",
      "name",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."name",
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(editions.map((edition) => edition.id))}::text[],
      ${toPgArray(editions.map((edition) => edition.coreId))}::text[],
      ${toPgArray(editions.map((edition) => edition.name))}::text[]
    ) AS input("id", "core_id", "name")
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "name"       = EXCLUDED."name",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
    WHERE
      "video_edition"."deleted_at" IS NOT NULL
      OR "video_edition"."name" IS DISTINCT FROM EXCLUDED."name"
  `
}

export async function syncVideoEditions({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }
  const seenCoreIds = new Set<string>()
  const PAGE_SIZE = 10000
  let offset = 0
  let firstPageWasEmpty = false

  while (true) {
    const result = await coreQuery<{ videoEditions: CoreVideoEdition[] }>(
      VIDEO_EDITIONS_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawEditions = result.data?.videoEditions ?? []
    if (offset === 0 && rawEditions.length === 0) firstPageWasEmpty = true

    const parsedEditions = CoreVideoEditionSchema.array().safeParse(rawEditions)
    if (!parsedEditions.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-edition.parse-error",
          offset,
          issues: parsedEditions.error.issues,
        }),
      )
      progress.increment(rawEditions.length)
      if (rawEditions.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const editions = parsedEditions.data
    if (editions.length === 0) break
    if (!since) {
      for (const edition of editions) seenCoreIds.add(edition.id)
    }

    progress.setTotal(offset + editions.length)

    try {
      const writes: EditionWrite[] = editions.map((edition) => ({
        id: randomUUID(),
        coreId: edition.id,
        name: edition.name ?? "",
      }))

      await prisma.$transaction(async (tx) => {
        await bulkUpsertVideoEditions(tx, writes)
      }, CORE_SYNC_TRANSACTION_OPTIONS)
      stats.updated += writes.length
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-edition.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(editions.length)
    if (rawEditions.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-edition.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.videoEdition.updateMany({
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
