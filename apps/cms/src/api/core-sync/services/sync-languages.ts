import type { Core } from "@strapi/strapi"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  getPrimaryValue,
  formatError,
  upsertByCoreId,
  softDeleteUnseen,
} from "./strapi-helpers"
import { bulkUpsertByCoreId } from "./bulk-upsert"

const LANGUAGES_QUERY = graphql(/* GraphQL */ `
  query SyncLanguages($where: LanguagesFilter) {
    languages(limit: 5000, where: $where) {
      id
      bcp47
      iso3
      slug
      name {
        value
        primary
        language {
          id
        }
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
`)

import type { ResultOf } from "@graphql-typed-document-node/core"

type CoreLanguage = ResultOf<typeof LANGUAGES_QUERY>["languages"][number]

/**
 * NOTE: We intentionally do NOT register BCP47 codes as Strapi i18n locales.
 *
 * With 2,265 locales registered, Strapi's i18n middleware runs
 * syncNonLocalizedAttributes on every create/update of localized content types,
 * which queries and updates ALL other locale versions of the document.
 * This turned a 1-minute video sync into a multi-day operation.
 *
 * BCP47 codes are stored as a field on the language content type instead.
 * Only "en" (the default locale) is used for actual content localization.
 */

export async function syncLanguages(
  strapi: Core.Strapi,
  progress: ProgressReporter,
  since?: string,
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  const mode = since ? "incremental" : "full"
  strapi.log.info(`[core-sync] Starting language sync (${mode})`)

  const variables: { where?: { updatedAt?: { gte: string } } } = {}
  if (since) {
    variables.where = { updatedAt: { gte: since } }
  }

  const { data } = await getCoreClient().query({
    query: LANGUAGES_QUERY,
    variables,
  })
  const languages = data.languages

  if (languages.length === 0 && !since) {
    strapi.log.error(
      "[core-sync] Core API returned 0 languages — circuit breaker: skipping sync",
    )
    return stats
  }

  if (languages.length === 0) {
    strapi.log.info("[core-sync] No languages updated since last sync")
    return stats
  }

  strapi.log.info(`[core-sync] Fetched ${languages.length} languages from core`)

  progress.setTotal(languages.length)

  const seenIds = new Set<string>()
  const languageDocMap = new Map<string, string>()

  for (const lang of languages) {
    seenIds.add(lang.id)

    try {
      const { documentId, action } = await upsertByCoreId(
        strapi,
        "api::language.language",
        lang.id,
        {
          name: getPrimaryValue(lang.name),
          bcp47: lang.bcp47 ?? undefined,
          iso3: lang.iso3 ?? undefined,
          slug: lang.slug ?? undefined,
        },
        { locale: "en" },
      )

      languageDocMap.set(lang.id, documentId)

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[core-sync] Failed to upsert language ${lang.id}: ${formatError(error)}`,
      )
    }

    progress.increment()
  }

  // Bulk upsert audio previews as separate content type
  const audioRecords = languages
    .filter((lang) => lang.audioPreview)
    .map((lang) => ({
      coreId: lang.id, // use language coreId as audio preview coreId (1:1)
      data: {
        value: lang.audioPreview!.value,
        duration: lang.audioPreview!.duration,
        size: lang.audioPreview!.size,
        bitrate: lang.audioPreview!.bitrate,
        codec: lang.audioPreview!.codec,
      },
      links: {
        language_audio_previews_language_lnk: languageDocMap.get(lang.id),
      },
    }))

  if (audioRecords.length > 0) {
    strapi.log.info(
      `[core-sync] Bulk upserting ${audioRecords.length} audio previews`,
    )
    const apStats = await bulkUpsertByCoreId(
      strapi,
      {
        tableName: "language_audio_previews",
        locale: "",
        linkConfigs: [
          {
            linkTable: "language_audio_previews_language_lnk",
            sourceColumn: "language_audio_preview_id",
            targetTable: "languages",
            targetColumn: "language_id",
            targetLocale: "en",
          },
        ],
      },
      audioRecords,
    )
    strapi.log.info(
      `[core-sync] Audio previews: ${apStats.created} created, ${apStats.updated} updated, ${apStats.errors} errors`,
    )
  }

  // Only run soft-delete on full syncs (incremental only sees a subset)
  if (!since) {
    stats.softDeleted = await softDeleteUnseen(
      strapi,
      "api::language.language",
      seenIds,
      "en",
    )
  }

  strapi.log.info(
    `[core-sync] Language sync complete (${mode}): ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
