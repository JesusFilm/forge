import type { Core } from "@strapi/strapi"
import { getGatewayClient } from "./gateway-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  getPrimaryValue,
  formatError,
  upsertByGatewayId,
  softDeleteUnseen,
} from "./strapi-helpers"

const LANGUAGES_QUERY = graphql(/* GraphQL */ `
  query SyncLanguages {
    languages(limit: 5000) {
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

type GatewayLanguage = ResultOf<typeof LANGUAGES_QUERY>["languages"][number]

async function ensureLocalesExist(
  strapi: Core.Strapi,
  languages: GatewayLanguage[],
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
    strapi.log.info("[gateway-sync] All locales already registered")
    return
  }

  strapi.log.info(
    `[gateway-sync] Registering ${newLocales.length} new locales...`,
  )

  // Batch insert via direct DB for speed (bypasses Strapi plugin overhead)
  // Direct DB insert — skip Strapi plugin validation for speed
  let registered = 0
  for (const locale of newLocales) {
    try {
      await strapi.db.query("plugin::i18n.locale").create({
        data: { code: locale.code, name: locale.name },
      })
      existingLocales.add(locale.code)
      registered++
      if (registered % 200 === 0) {
        strapi.log.info(
          `[gateway-sync] Locales: ${registered}/${newLocales.length} registered`,
        )
      }
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to register locale ${locale.code}: ${formatError(error)}`,
      )
    }
  }

  strapi.log.info(
    `[gateway-sync] Locale registration complete: ${registered} registered`,
  )
}

export async function syncLanguages(strapi: Core.Strapi): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  strapi.log.info("[gateway-sync] Starting language sync")

  const { data } = await getGatewayClient().query({ query: LANGUAGES_QUERY })
  const languages = data.languages

  if (languages.length === 0) {
    strapi.log.error(
      "[gateway-sync] Gateway returned 0 languages — circuit breaker: skipping sync",
    )
    return stats
  }

  strapi.log.info(
    `[gateway-sync] Fetched ${languages.length} languages from gateway`,
  )

  // Register all BCP47 codes as Strapi i18n locales (single DB read)
  await ensureLocalesExist(strapi, languages)

  const seenIds = new Set<string>()

  for (const lang of languages) {
    seenIds.add(lang.id)

    try {
      const { action } = await upsertByGatewayId(
        strapi,
        "api::language.language",
        lang.id,
        {
          name: getPrimaryValue(lang.name),
          bcp47: lang.bcp47 ?? undefined,
          iso3: lang.iso3 ?? undefined,
          slug: lang.slug ?? undefined,
          ...(lang.audioPreview && {
            audioPreview: {
              value: lang.audioPreview.value,
              duration: lang.audioPreview.duration,
              size: lang.audioPreview.size,
              bitrate: lang.audioPreview.bitrate,
              codec: lang.audioPreview.codec,
            },
          }),
        },
        { locale: "en" },
      )

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[gateway-sync] Failed to upsert language ${lang.id}: ${formatError(error)}`,
      )
    }
  }

  stats.softDeleted = await softDeleteUnseen(
    strapi,
    "api::language.language",
    seenIds,
    "en",
  )

  strapi.log.info(
    `[gateway-sync] Language sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
