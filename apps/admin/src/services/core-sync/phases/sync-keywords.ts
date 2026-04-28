// Sync phase: keywords
// Depends on: languages (keyword.languageId FK)
//
// Single-batch (no paging — Core returns the full keyword list in one
// query). Bulk INSERT … ON CONFLICT DO UPDATE; see bulk-upsert.ts
// header for the prod failure mode this replaces.

import { Prisma, type PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreKeywordSchema } from "../schemas/keyword"
import { emptySyncStats } from "../types"
import { bulkErrorLogFields, newRowId } from "../bulk-upsert"

const KEYWORDS_QUERY = `
  query Keywords($where: KeywordsFilter) {
    keywords(where: $where) {
      id
      value
      language { id }
    }
  }
`

type CoreKeyword = {
  id: string
  value: string
  language: { id: string } | null
}

export async function syncKeywords({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const seenCoreIds = new Set<string>()
  const result = await coreQuery<{ keywords: CoreKeyword[] }>(KEYWORDS_QUERY, {
    where: since ? { updatedAt: { gte: since } } : undefined,
  })

  const rawKeywords = result.data?.keywords ?? []
  const parsedKeywords = CoreKeywordSchema.array().safeParse(rawKeywords)
  if (!parsedKeywords.success) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.keyword.parse-error",
        issues: parsedKeywords.error.issues,
      }),
    )
    progress.increment(rawKeywords.length)
    return stats
  }

  const keywords = parsedKeywords.data
  if (keywords.length === 0 && !since) {
    console.warn(
      JSON.stringify({
        event: "core-sync.keyword.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (keywords.length === 0) {
    return stats
  }

  if (!since) {
    for (const keyword of keywords) {
      seenCoreIds.add(keyword.id)
    }
  }

  progress.setTotal(keywords.length)

  try {
    const now = new Date()
    const rowTuples = keywords.map((keyword) => {
      const languageId = keyword.language
        ? (langMap.get(keyword.language.id) ?? null)
        : null
      // Column order: id, core_id, value, language_id, synced_at, updated_at
      return Prisma.sql`(${newRowId()}, ${keyword.id}, ${keyword.value}, ${languageId}, ${now}, ${now})`
    })

    const affected = await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "keyword" ("id", "core_id", "value", "language_id", "synced_at", "updated_at")
        VALUES ${Prisma.join(rowTuples, ", ")}
        ON CONFLICT ("core_id") DO UPDATE SET
          "value"       = EXCLUDED."value",
          "language_id" = EXCLUDED."language_id",
          "synced_at"   = EXCLUDED."synced_at",
          "updated_at"  = EXCLUDED."updated_at",
          "deleted_at"  = NULL
      `,
    )
    stats.updated += Number(affected)
  } catch (err) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.keyword.error",
        firstCoreId: keywords[0]?.id,
        lastCoreId: keywords[keywords.length - 1]?.id,
        ...bulkErrorLogFields(err),
      }),
    )
  }

  progress.increment(keywords.length)

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.keyword.updateMany({
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
