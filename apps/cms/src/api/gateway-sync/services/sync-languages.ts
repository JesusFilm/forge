import type { Core } from "@strapi/strapi"
import { queryGateway } from "./gateway-client"
import { upsertByGatewayId, softDeleteUnseen } from "./strapi-helpers"

const LANGUAGES_QUERY = `
  query {
    languages(limit: 5000) {
      id
      bcp47
      iso3
      slug
      name(primary: true) {
        value
        primary
        language { id }
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

type GatewayLanguageName = {
  value: string
  primary: boolean
  language: { id: string }
}

type GatewayLanguage = {
  id: string
  bcp47: string | null
  iso3: string | null
  slug: string | null
  name: GatewayLanguageName[]
  audioPreview: {
    value: string
    duration: number
    size: number
    bitrate: number
    codec: string
  } | null
}

type LanguagesResponse = {
  languages: GatewayLanguage[]
}

export type SyncStats = {
  created: number
  updated: number
  softDeleted: number
  errors: number
}

async function ensureLocaleExists(
  strapi: Core.Strapi,
  code: string,
  name: string,
): Promise<void> {
  try {
    const locales = (await strapi
      .plugin("i18n")
      .service("locales")
      .find()) as Array<{ code: string }>
    if (locales.some((l) => l.code === code)) return

    try {
      await strapi
        .plugin("i18n")
        .service("locales")
        .create({ code, name: `${name} (${code})` })
    } catch {
      // Fallback to direct DB insert per Strapi issue #13244
      await strapi.db
        .query("plugin::i18n.locale")
        .create({ data: { code, name: `${name} (${code})` } })
    }
    strapi.log.info(`[gateway-sync] Registered locale: ${code}`)
  } catch (error) {
    strapi.log.warn(
      `[gateway-sync] Failed to register locale ${code}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function getPrimaryName(names: GatewayLanguageName[]): string {
  const primary = names.find((n) => n.primary)
  return primary?.value ?? names[0]?.value ?? ""
}

export async function syncLanguages(strapi: Core.Strapi): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  strapi.log.info("[gateway-sync] Starting language sync")

  const data = await queryGateway<LanguagesResponse>(LANGUAGES_QUERY)
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

  // First pass: register BCP47 codes as Strapi i18n locales
  for (const lang of languages) {
    if (lang.bcp47) {
      await ensureLocaleExists(strapi, lang.bcp47, getPrimaryName(lang.name))
    }
  }

  const seenIds = new Set<string>()

  // Second pass: upsert Language records
  for (const lang of languages) {
    seenIds.add(lang.id)

    try {
      const { action } = await upsertByGatewayId(
        strapi,
        "api::language.language",
        lang.id,
        {
          name: getPrimaryName(lang.name),
          bcp47: lang.bcp47 ?? undefined,
          iso3: lang.iso3 ?? undefined,
          slug: lang.slug ?? undefined,
          audioPreview: lang.audioPreview
            ? {
                value: lang.audioPreview.value,
                duration: lang.audioPreview.duration,
                size: lang.audioPreview.size,
                bitrate: lang.audioPreview.bitrate,
                codec: lang.audioPreview.codec,
              }
            : undefined,
        },
        { locale: "en" },
      )

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[gateway-sync] Failed to upsert language ${lang.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Soft-delete pass
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
