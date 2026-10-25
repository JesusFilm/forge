// Sync phase: video-origins

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreVideoOriginSchema } from "../schemas/video-origin"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"

const PAGE_SIZE = 10000

const VIDEO_ORIGINS_QUERY = `
  query VideoOrigins($offset: Int!, $limit: Int!, $where: VideoOriginsFilter) {
    videoOrigins(offset: $offset, limit: $limit, where: $where) {
      id
      updatedAt
      name
      description
    }
  }
`

type CoreVideoOrigin = {
  id: string
  updatedAt?: string
  name: string
  description: string | null
}

export async function syncVideoOrigins({
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
  let offset = 0
  let firstPageWasEmpty = false

  while (true) {
    const result = await coreQuery<{ videoOrigins: CoreVideoOrigin[] }>(
      VIDEO_ORIGINS_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawOrigins = result.data?.videoOrigins ?? []
    if (offset === 0 && rawOrigins.length === 0) firstPageWasEmpty = true

    const parsedOrigins = CoreVideoOriginSchema.array().safeParse(rawOrigins)
    if (!parsedOrigins.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.video-origin.parse-error",
          offset,
          issues: parsedOrigins.error.issues,
        }),
      )
      progress.increment(rawOrigins.length)
      if (rawOrigins.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const origins = parsedOrigins.data
    if (origins.length === 0) break
    if (!since) {
      for (const origin of origins) seenCoreIds.add(origin.id)
    }
    progress.setTotal(offset + origins.length)

    try {
      let updated = 0
      await prisma.$transaction(async (tx) => {
        for (const origin of origins) {
          await tx.videoOrigin.upsert({
            where: { coreId: origin.id },
            create: {
              coreId: origin.id,
              name: origin.name,
              description: origin.description,
              syncedAt: new Date(),
            },
            update: {
              name: origin.name,
              description: origin.description,
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
          event: "core-sync.video-origin.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(origins.length)
    if (rawOrigins.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.video-origin.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.videoOrigin.updateMany({
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
