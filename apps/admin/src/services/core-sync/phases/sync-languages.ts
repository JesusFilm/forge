// Sync phase: languages
//
// First phase in PHASE_ORDER. Languages are reference data with
// localized name stored as a JSON column keyed by locale.

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreLanguageSchema } from "../schemas/language"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import {
  toLocalizedNames,
  toNameMap,
  type CoreLocalizedValue,
} from "../transforms"

const LANGUAGES_QUERY = `
  query Languages($offset: Int!, $limit: Int!, $where: LanguagesFilter) {
    languages(offset: $offset, limit: $limit, where: $where) {
      id
      bcp47
      iso3
      slug
      name {
        value
        primary
        language { bcp47 id }
      }
      audioPreview {
        value
        duration
        size
        bitrate
        codec
      }
    }
  }
`

type CoreLanguage = {
  id: string
  bcp47: string | null
  iso3: string | null
  slug: string | null
  name: CoreLocalizedValue[]
  audioPreview: {
    value: string | null
    duration: number | null
    size: string | number | null
    bitrate: number | null
    codec: string | null
  } | null
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
  const PAGE_SIZE = 10000
  let offset = 0
  let firstPageCount = 0
  const seenCoreIds = new Set<string>()
  const existingLanguages = await prisma.language.findMany({
    select: { coreId: true, slug: true },
  })
  const slugOwners = new Map(
    existingLanguages
      .filter((language) => language.slug)
      .map((language) => [language.slug!, language.coreId]),
  )

  while (true) {
    const result = await coreQuery<{ languages: CoreLanguage[] }>(
      LANGUAGES_QUERY,
      {
        offset,
        limit: PAGE_SIZE,
        where: since ? { updatedAt: { gte: since } } : undefined,
      },
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
      await prisma.$transaction(async (tx) => {
        for (const lang of languages) {
          const nameMap = toNameMap(lang.name)
          const audioPreviewSize = lang.audioPreview?.size
            ? BigInt(lang.audioPreview.size)
            : null
          const slugOwner = lang.slug ? slugOwners.get(lang.slug) : undefined
          const slug =
            lang.slug && (!slugOwner || slugOwner === lang.id)
              ? lang.slug
              : null
          if (lang.slug && !slug) {
            console.warn(
              JSON.stringify({
                event: "core-sync.language.duplicate-slug",
                languageCoreId: lang.id,
                slug: lang.slug,
                existingLanguageCoreId: slugOwner,
              }),
            )
          } else if (slug) {
            slugOwners.set(slug, lang.id)
          }

          const language = await tx.language.upsert({
            where: { coreId: lang.id },
            create: {
              coreId: lang.id,
              bcp47: lang.bcp47,
              iso3: lang.iso3,
              slug,
              name: nameMap,
              audioPreviewValue: lang.audioPreview?.value ?? null,
              audioPreviewDuration: lang.audioPreview?.duration ?? null,
              audioPreviewSize,
              audioPreviewBitrate: lang.audioPreview?.bitrate ?? null,
              audioPreviewCodec: lang.audioPreview?.codec ?? null,
              syncedAt: new Date(),
            },
            update: {
              bcp47: lang.bcp47,
              iso3: lang.iso3,
              slug,
              name: nameMap,
              audioPreviewValue: lang.audioPreview?.value ?? null,
              audioPreviewDuration: lang.audioPreview?.duration ?? null,
              audioPreviewSize,
              audioPreviewBitrate: lang.audioPreview?.bitrate ?? null,
              audioPreviewCodec: lang.audioPreview?.codec ?? null,
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
          const localeRows = toLocalizedNames(lang.name)
          for (const localeRow of localeRows) {
            await tx.languageLocale.upsert({
              where: {
                languageId_locale: {
                  languageId: language.id,
                  locale: localeRow.locale,
                },
              },
              create: {
                languageId: language.id,
                locale: localeRow.locale,
                value: localeRow.value,
                primary: localeRow.primary,
                order: localeRow.order,
                syncedAt: new Date(),
              },
              update: {
                value: localeRow.value,
                primary: localeRow.primary,
                order: localeRow.order,
                syncedAt: new Date(),
                deletedAt: null,
              },
            })
          }
          await tx.languageLocale.updateMany({
            where: {
              languageId: language.id,
              source: "CORE",
              locale: { notIn: localeRows.map((row) => row.locale) },
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          })
          pageUpdated++
        }
      }, CORE_SYNC_TRANSACTION_OPTIONS)
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
    await prisma.languageLocale.updateMany({
      where: {
        source: "CORE",
        language: { coreId: { notIn: [...seenCoreIds] } },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })
  }

  return stats
}
