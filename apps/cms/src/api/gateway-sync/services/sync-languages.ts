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

  for (const lang of languages) {
    if (!lang.bcp47 || existingLocales.has(lang.bcp47)) continue

    try {
      const name = getPrimaryValue(lang.name)
      try {
        await strapi
          .plugin("i18n")
          .service("locales")
          .create({ code: lang.bcp47, name: `${name} (${lang.bcp47})` })
      } catch {
        // Fallback to direct DB insert per Strapi issue #13244
        await strapi.db.query("plugin::i18n.locale").create({
          data: { code: lang.bcp47, name: `${name} (${lang.bcp47})` },
        })
      }
      existingLocales.add(lang.bcp47)
      strapi.log.info(`[gateway-sync] Registered locale: ${lang.bcp47}`)
    } catch (error) {
      strapi.log.warn(
        `[gateway-sync] Failed to register locale ${lang.bcp47}: ${formatError(error)}`,
      )
    }
  }
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
