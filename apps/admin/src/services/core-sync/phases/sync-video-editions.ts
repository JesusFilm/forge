// Sync phase: video-editions
// Depends on: videos indirectly through downstream dubs/subtitles, but the
// edition catalogue itself is a standalone Core query.

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoEditionSchema } from "../schemas/video-edition"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"

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
      let updated = 0
      await prisma.$transaction(async (tx) => {
        for (const edition of editions) {
          await tx.videoEdition.upsert({
            where: { coreId: edition.id },
            create: {
              coreId: edition.id,
              name: edition.name ?? "",
              syncedAt: new Date(),
            },
            update: {
              name: edition.name ?? "",
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
