// Sync phase: languages
//
// First phase in PHASE_ORDER. Languages are reference data with
// localized name stored as a JSON column keyed by locale.

import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreLanguageSchema } from "../schemas/language"
import { emptySyncStats } from "../types"
import { toPgArray } from "@/db/pgvector"
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

type LanguageLocaleWrite = {
  id: string
  languageCoreId: string
  locale: string
  value: string
  primary: boolean
  order: number | null
}

function encodeJsonForPgArray(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64")
}

async function bulkUpsertLanguages(
  prisma: PrismaClient,
  languages: ReadonlyArray<{
    id: string
    coreId: string
    bcp47: string | null
    iso3: string | null
    slug: string | null
    nameBase64: string
    audioPreviewValue: string | null
    audioPreviewDuration: number | null
    audioPreviewSize: string | null
    audioPreviewBitrate: number | null
    audioPreviewCodec: string | null
  }>,
) {
  if (languages.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "language" (
      "id",
      "core_id",
      "source",
      "bcp47",
      "iso3",
      "slug",
      "name",
      "audio_preview_value",
      "audio_preview_duration",
      "audio_preview_size",
      "audio_preview_bitrate",
      "audio_preview_codec",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      input."bcp47",
      input."iso3",
      input."slug",
      convert_from(decode(input."name_base64", 'base64'), 'UTF8')::jsonb,
      input."audio_preview_value",
      input."audio_preview_duration_text"::int,
      input."audio_preview_size_text"::bigint,
      input."audio_preview_bitrate_text"::int,
      input."audio_preview_codec",
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(languages.map((language) => language.id))}::text[],
      ${toPgArray(languages.map((language) => language.coreId))}::text[],
      ${toPgArray(languages.map((language) => language.bcp47))}::text[],
      ${toPgArray(languages.map((language) => language.iso3))}::text[],
      ${toPgArray(languages.map((language) => language.slug))}::text[],
      ${toPgArray(languages.map((language) => language.nameBase64))}::text[],
      ${toPgArray(languages.map((language) => language.audioPreviewValue))}::text[],
      ${toPgArray(languages.map((language) => language.audioPreviewDuration?.toString() ?? null))}::text[],
      ${toPgArray(languages.map((language) => language.audioPreviewSize))}::text[],
      ${toPgArray(languages.map((language) => language.audioPreviewBitrate?.toString() ?? null))}::text[],
      ${toPgArray(languages.map((language) => language.audioPreviewCodec))}::text[]
    ) AS input(
      "id",
      "core_id",
      "bcp47",
      "iso3",
      "slug",
      "name_base64",
      "audio_preview_value",
      "audio_preview_duration_text",
      "audio_preview_size_text",
      "audio_preview_bitrate_text",
      "audio_preview_codec"
    )
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "bcp47"                  = EXCLUDED."bcp47",
      "iso3"                   = EXCLUDED."iso3",
      "slug"                   = EXCLUDED."slug",
      "name"                   = EXCLUDED."name",
      "audio_preview_value"    = EXCLUDED."audio_preview_value",
      "audio_preview_duration" = EXCLUDED."audio_preview_duration",
      "audio_preview_size"     = EXCLUDED."audio_preview_size",
      "audio_preview_bitrate"  = EXCLUDED."audio_preview_bitrate",
      "audio_preview_codec"    = EXCLUDED."audio_preview_codec",
      "synced_at"              = EXCLUDED."synced_at",
      "updated_at"             = EXCLUDED."updated_at",
      "deleted_at"             = NULL
  `
}

async function bulkUpsertLanguageLocales(
  prisma: PrismaClient,
  locales: ReadonlyArray<LanguageLocaleWrite>,
) {
  if (locales.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "language_locale" (
      "id",
      "source",
      "language_id",
      "locale",
      "value",
      "primary",
      "order",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      'core'::"SourceTier",
      language."id",
      input."locale",
      input."value",
      input."primary_text"::boolean,
      input."order_text"::int,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(locales.map((locale) => locale.id))}::text[],
      ${toPgArray(locales.map((locale) => locale.languageCoreId))}::text[],
      ${toPgArray(locales.map((locale) => locale.locale))}::text[],
      ${toPgArray(locales.map((locale) => locale.value))}::text[],
      ${toPgArray(locales.map((locale) => String(locale.primary)))}::text[],
      ${toPgArray(locales.map((locale) => locale.order?.toString() ?? null))}::text[]
    ) AS input(
      "id",
      "language_core_id",
      "locale",
      "value",
      "primary_text",
      "order_text"
    )
    JOIN "language" language
      ON language."core_id" = input."language_core_id"
    ON CONFLICT ("language_id", "locale")
    DO UPDATE SET
      "value"      = EXCLUDED."value",
      "primary"    = EXCLUDED."primary",
      "order"      = EXCLUDED."order",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
  `
}

async function softDeleteStaleLanguageLocales(
  prisma: PrismaClient,
  locales: ReadonlyArray<LanguageLocaleWrite>,
) {
  if (locales.length === 0) return

  await prisma.$executeRaw`
    WITH synced("language_core_id", "locale") AS (
      SELECT *
      FROM unnest(
        ${toPgArray(locales.map((locale) => locale.languageCoreId))}::text[],
        ${toPgArray(locales.map((locale) => locale.locale))}::text[]
      )
    ),
    synced_languages("language_core_id") AS (
      SELECT DISTINCT "language_core_id" FROM synced
    )
    UPDATE "language_locale" locale
    SET "deleted_at" = NOW()
    FROM "language" language
    WHERE locale."language_id" = language."id"
      AND locale."source" = 'core'::"SourceTier"
      AND locale."deleted_at" IS NULL
      AND language."core_id" IN (
        SELECT "language_core_id" FROM synced_languages
      )
      AND NOT EXISTS (
        SELECT 1
        FROM synced
        WHERE synced."language_core_id" = language."core_id"
          AND synced."locale" = locale."locale"
      )
  `
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
      const localeWrites: LanguageLocaleWrite[] = []
      const languageWrites = languages.map((lang) => {
        const slugOwner = lang.slug ? slugOwners.get(lang.slug) : undefined
        const slug =
          lang.slug && (!slugOwner || slugOwner === lang.id) ? lang.slug : null
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

        for (const localeRow of toLocalizedNames(lang.name)) {
          localeWrites.push({
            id: randomUUID(),
            languageCoreId: lang.id,
            locale: localeRow.locale,
            value: localeRow.value,
            primary: localeRow.primary,
            order: localeRow.order ?? null,
          })
        }

        return {
          id: randomUUID(),
          coreId: lang.id,
          bcp47: lang.bcp47,
          iso3: lang.iso3,
          slug,
          nameBase64: encodeJsonForPgArray(toNameMap(lang.name)),
          audioPreviewValue: lang.audioPreview?.value ?? null,
          audioPreviewDuration: lang.audioPreview?.duration ?? null,
          audioPreviewSize: lang.audioPreview?.size
            ? String(lang.audioPreview.size)
            : null,
          audioPreviewBitrate: lang.audioPreview?.bitrate ?? null,
          audioPreviewCodec: lang.audioPreview?.codec ?? null,
        }
      })

      await bulkUpsertLanguages(prisma, languageWrites)
      await bulkUpsertLanguageLocales(prisma, localeWrites)
      await softDeleteStaleLanguageLocales(prisma, localeWrites)
      stats.updated += languageWrites.length
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
