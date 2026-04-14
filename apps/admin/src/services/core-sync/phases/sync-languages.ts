// Sync phase: languages
//
// First phase in PHASE_ORDER. Languages are reference data with
// localized name stored as a JSON column keyed by locale.

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { emptySyncStats } from "../types"

const LANGUAGES_QUERY = `
  query Languages($offset: Int!, $limit: Int!) {
    languages(offset: $offset, limit: $limit) {
      id
      bcp47
      iso3
      name {
        value
        language { bcp47 }
      }
    }
  }
`

type CoreLanguage = {
  id: string
  bcp47: string | null
  iso3: string | null
  name: Array<{ value: string; language: { bcp47: string } }>
}

export async function syncLanguages({
  prisma,
  progress,
  since: _since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }
  const PAGE_SIZE = 500
  let offset = 0

  while (true) {
    const result = await coreQuery<{ languages: CoreLanguage[] }>(
      LANGUAGES_QUERY,
      { offset, limit: PAGE_SIZE },
    )

    const languages = result.data?.languages ?? []
    if (languages.length === 0) break

    progress.setTotal(offset + languages.length)

    for (const lang of languages) {
      try {
        const nameMap: Record<string, string> = {}
        for (const n of lang.name) {
          nameMap[n.language.bcp47] = n.value
        }

        await prisma.language.upsert({
          where: { coreId: lang.id },
          create: {
            coreId: lang.id,
            bcp47: lang.bcp47,
            iso3: lang.iso3,
            name: nameMap,
            syncedAt: new Date(),
          },
          update: {
            bcp47: lang.bcp47,
            iso3: lang.iso3,
            name: nameMap,
            syncedAt: new Date(),
          },
        })
        stats.updated++
      } catch (err) {
        stats.errors++
        console.error(
          JSON.stringify({
            event: "core-sync.language.error",
            coreId: lang.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
      progress.increment()
    }

    if (languages.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return stats
}
