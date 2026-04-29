// Sync phase: keywords
// Depends on: languages (keyword.languageId FK)

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreKeywordSchema } from "../schemas/keyword"
import { emptySyncStats } from "../types"

const KEYWORDS_QUERY = `
  query Keywords {
    keywords {
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
  if (since) {
    console.info(
      JSON.stringify({
        event: "core-sync.keyword.incremental-ignored",
        reason: "core_keywords_query_has_no_updated_at_filter",
      }),
    )
  }

  const result = await coreQuery<{ keywords: CoreKeyword[] }>(KEYWORDS_QUERY)

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
  if (keywords.length === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.keyword.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  for (const keyword of keywords) {
    seenCoreIds.add(keyword.id)
  }

  progress.setTotal(keywords.length)

  try {
    let pageUpdated = 0
    await prisma.$transaction(
      async (tx) => {
        for (const keyword of keywords) {
          const languageId = keyword.language
            ? (langMap.get(keyword.language.id) ?? null)
            : null

          await tx.keyword.upsert({
            where: { coreId: keyword.id },
            create: {
              coreId: keyword.id,
              value: keyword.value,
              languageId,
              syncedAt: new Date(),
            },
            update: {
              value: keyword.value,
              languageId,
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
          pageUpdated++
        }
      },
      { timeout: 60_000, maxWait: 5_000 },
    )
    stats.updated += pageUpdated
  } catch (err) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.keyword.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  progress.increment(keywords.length)

  if (stats.errors === 0 && seenCoreIds.size > 0) {
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
