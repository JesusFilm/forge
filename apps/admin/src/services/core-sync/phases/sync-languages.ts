// Sync phase: languages
//
// First phase in PHASE_ORDER. Languages are reference data with
// localized name stored as a JSON column keyed by locale.

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreLanguageSchema } from "../schemas/language"
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
  name: Array<{ value: string; language: { bcp47?: string } }>
}

export async function syncLanguages({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }
  const PAGE_SIZE = 500
  let offset = 0
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()

  while (true) {
    const result = await coreQuery<{ languages: CoreLanguage[] }>(
      LANGUAGES_QUERY,
      { offset, limit: PAGE_SIZE },
    )

    const rawLanguages = result.data?.languages ?? []
    if (offset === 0) {
      firstPageCount = rawLanguages.length
    }

    const parsedLanguages = CoreLanguageSchema.array().safeParse(rawLanguages)
    if (!parsedLanguages.success) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.language.parse-error",
          offset,
          issues: parsedLanguages.error.issues,
        }),
      )
      progress.increment(rawLanguages.length)
      if (rawLanguages.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      continue
    }

    const languages = parsedLanguages.data
    if (languages.length === 0) break

    if (!since) {
      for (const lang of languages) {
        seenCoreIds.add(lang.id)
      }
    }

    progress.setTotal(offset + languages.length)

    try {
      let pageUpdated = 0
      await prisma.$transaction(
        async (tx) => {
          for (const lang of languages) {
            const nameMap: Record<string, string> = {}
            for (const n of lang.name) {
              if (n.language.bcp47) {
                nameMap[n.language.bcp47] = n.value
              }
            }

            await tx.language.upsert({
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
                deletedAt: null,
              },
            })
            pageUpdated++
          }
        },
        { timeout: 5_000, maxWait: 2_000 },
      )
      stats.updated += pageUpdated
    } catch (err) {
      stats.errors++
      console.error(
        JSON.stringify({
          event: "core-sync.language.error",
          offset,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    progress.increment(languages.length)

    if (languages.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (!since && firstPageCount === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.language.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.language.updateMany({
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
