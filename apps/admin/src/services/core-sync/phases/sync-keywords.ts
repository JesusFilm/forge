// Sync phase: keywords
// Depends on: languages (keyword.languageId FK)

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreKeywordSchema } from "../schemas/keyword"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"

const KEYWORDS_QUERY = `
  query Keywords($offset: Int!, $limit: Int!, $where: KeywordsFilter) {
    keywords(offset: $offset, limit: $limit, where: $where) {
      id
      updatedAt
      value
      language { id }
    }
  }
`

type CoreKeyword = {
  id: string
  updatedAt?: string
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
  const PAGE_SIZE = 10000
  let offset = 0
  let firstPageWasEmpty = false

  while (true) {
    const result = await coreQuery<{ keywords: CoreKeyword[] }>(
      KEYWORDS_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
    )

    const rawKeywords = result.data?.keywords ?? []
    if (offset === 0 && rawKeywords.length === 0) firstPageWasEmpty = true

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
      if (rawKeywords.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const keywords = parsedKeywords.data
    if (keywords.length === 0) break
    if (!since) {
      for (const keyword of keywords) seenCoreIds.add(keyword.id)
    }

    progress.setTotal(offset + keywords.length)

    try {
      let pageUpdated = 0
      await prisma.$transaction(async (tx) => {
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
      }, CORE_SYNC_TRANSACTION_OPTIONS)
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
    if (rawKeywords.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageWasEmpty) {
    console.warn(
      JSON.stringify({
        event: "core-sync.keyword.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

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
