import type { Core } from "@strapi/strapi"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  getPrimaryValue,
  formatError,
  softDeleteUnseen,
  buildCoreIdMap,
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

async function ensureLocalesExist(
  strapi: Core.Strapi,
  languages: CoreLanguage[],
): Promise<void> {
  // Fetch all existing locales ONCE
  const existingLocales = new Set(
    (
      (await strapi.plugin("i18n").service("locales").find()) as Array<{
        code: string
      }>
    ).map((l) => l.code),
  )

  // Filter to only new locales
  const newLocales = languages
    .filter((lang) => lang.bcp47 && !existingLocales.has(lang.bcp47))
    .map((lang) => ({
      code: lang.bcp47!,
      name: `${getPrimaryValue(lang.name)} (${lang.bcp47})`,
    }))

  if (newLocales.length === 0) {
    strapi.log.info("[core-sync] All locales already registered")
    return
  }

  strapi.log.info(`[core-sync] Registering ${newLocales.length} new locales...`)

  // Raw knex bulk insert — bypasses ORM entirely for maximum speed
  const BATCH_SIZE = 500
  let registered = 0
  const knex = strapi.db.connection

  for (let i = 0; i < newLocales.length; i += BATCH_SIZE) {
    const batch = newLocales.slice(i, i + BATCH_SIZE).map((l) => ({
      code: l.code,
      name: l.name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    try {
      await knex("i18n_locale").insert(batch)
      for (const l of batch) existingLocales.add(l.code)
      registered += batch.length
      strapi.log.info(
        `[core-sync] Locales: ${registered}/${newLocales.length} registered`,
      )
    } catch {
      // Fallback to one-by-one if batch fails (e.g. duplicate)
      for (const l of batch) {
        try {
          await knex("i18n_locale").insert(l)
          existingLocales.add(l.code)
          registered++
        } catch {
          // skip duplicates
        }
      }
    }
  }

  strapi.log.info(
    `[core-sync] Locale registration complete: ${registered} registered`,
  )
}

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

  // Register all BCP47 codes as Strapi i18n locales (single DB read)
  await ensureLocalesExist(strapi, languages)

  const seenIds = new Set(languages.map((l) => l.id))

  const langRecords = languages.map((lang) => ({
    coreId: lang.id,
    data: {
      name: getPrimaryValue(lang.name),
      bcp47: lang.bcp47 ?? null,
      iso3: lang.iso3 ?? null,
      slug: lang.slug ?? null,
    },
    links: {},
  }))

  const langStats = await bulkUpsertByCoreId(
    strapi,
    { tableName: "languages", locale: "en", linkConfigs: [] },
    langRecords,
    progress,
  )
  stats.created = langStats.created
  stats.updated = langStats.updated
  stats.errors = langStats.errors

  // Bulk upsert audio previews as separate content type
  const languageDocMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )
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
