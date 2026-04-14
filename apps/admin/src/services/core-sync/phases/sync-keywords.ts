// Sync phase: keywords
// Depends on: languages (keyword.languageId FK)

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { emptySyncStats } from "../types"

const KEYWORDS_QUERY = `
  query Keywords($offset: Int!, $limit: Int!) {
    keywords(offset: $offset, limit: $limit) {
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
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }

  // Build language coreId → id map
  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

  const PAGE_SIZE = 500
  let offset = 0

  while (true) {
    const result = await coreQuery<{ keywords: CoreKeyword[] }>(
      KEYWORDS_QUERY,
      { offset, limit: PAGE_SIZE },
    )

    const keywords = result.data?.keywords ?? []
    if (keywords.length === 0) break
    progress.setTotal(offset + keywords.length)

    for (const kw of keywords) {
      try {
        const languageId = kw.language
          ? (langMap.get(kw.language.id) ?? null)
          : null

        await prisma.keyword.upsert({
          where: { coreId: kw.id },
          create: {
            coreId: kw.id,
            value: kw.value,
            ...(languageId ? { languageId } : {}),
            syncedAt: new Date(),
          },
          update: {
            value: kw.value,
            ...(languageId ? { languageId } : {}),
            syncedAt: new Date(),
          },
        })
        stats.updated++
      } catch {
        stats.errors++
      }
      progress.increment()
    }

    if (keywords.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return stats
}
