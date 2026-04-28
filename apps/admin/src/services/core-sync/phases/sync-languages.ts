// Sync phase: languages
//
// First phase in PHASE_ORDER. Languages are reference data with
// localized name stored as a JSON column keyed by locale.
//
// Bulk INSERT ... ON CONFLICT DO UPDATE per page (one round-trip,
// atomic without a transaction wrapper). Replaces the per-row upsert
// loop inside `$transaction({ timeout: 5_000 })` that timed out in
// prod on every page (see commit message + bulk-upsert.ts header).

import { Prisma, type PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreLanguageSchema } from "../schemas/language"
import { emptySyncStats } from "../types"
import { jsonbParam, newRowId } from "../bulk-upsert"

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
      const now = new Date()
      const rowTuples = languages.map((lang) => {
        const nameMap: Record<string, string> = {}
        for (const n of lang.name) {
          if (n.language.bcp47) {
            nameMap[n.language.bcp47] = n.value
          }
        }
        // Column order: id, core_id, name, bcp47, iso3, synced_at, updated_at
        return Prisma.sql`(${newRowId()}, ${lang.id}, ${jsonbParam(nameMap)}, ${lang.bcp47}, ${lang.iso3}, ${now}, ${now})`
      })

      const affected = await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "language" ("id", "core_id", "name", "bcp47", "iso3", "synced_at", "updated_at")
          VALUES ${Prisma.join(rowTuples, ", ")}
          ON CONFLICT ("core_id") DO UPDATE SET
            "bcp47"      = EXCLUDED."bcp47",
            "iso3"       = EXCLUDED."iso3",
            "name"       = EXCLUDED."name",
            "synced_at"  = EXCLUDED."synced_at",
            "updated_at" = EXCLUDED."updated_at",
            "deleted_at" = NULL
        `,
      )
      stats.updated += Number(affected)
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
