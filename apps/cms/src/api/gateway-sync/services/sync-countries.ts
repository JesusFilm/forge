import type { Core } from "@strapi/strapi"
import { queryGateway } from "./gateway-client"
import {
  findByGatewayId,
  upsertByGatewayId,
  softDeleteUnseen,
} from "./strapi-helpers"
import type { SyncStats } from "./sync-languages"

const COUNTRIES_QUERY = `
  query {
    countries {
      id
      population
      latitude
      longitude
      flagPngSrc
      flagWebpSrc
      languageCount
      languageHavingMediaCount
      continent {
        id
        name(primary: true) {
          value
          primary
          language { id }
        }
      }
      name(primary: true) {
        value
        primary
        language { id }
      }
      countryLanguages {
        id
        speakers
        displaySpeakers
        primary
        suggested
        order
        language { id }
      }
    }
  }
`

type GatewayTranslation = {
  value: string
  primary: boolean
  language: { id: string }
}

type GatewayCountryLanguage = {
  id: string
  speakers: number
  displaySpeakers: number | null
  primary: boolean
  suggested: boolean
  order: number | null
  language: { id: string }
}

type GatewayCountry = {
  id: string
  population: number | null
  latitude: number | null
  longitude: number | null
  flagPngSrc: string | null
  flagWebpSrc: string | null
  languageCount: number | null
  languageHavingMediaCount: number | null
  continent: { id: string; name: GatewayTranslation[] }
  name: GatewayTranslation[]
  countryLanguages: GatewayCountryLanguage[]
}

type CountriesResponse = {
  countries: GatewayCountry[]
}

function getPrimaryValue(translations: GatewayTranslation[]): string {
  const primary = translations.find((t) => t.primary)
  return primary?.value ?? translations[0]?.value ?? ""
}

export async function syncCountries(strapi: Core.Strapi): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  strapi.log.info("[gateway-sync] Starting country sync")

  const data = await queryGateway<CountriesResponse>(COUNTRIES_QUERY)
  const countries = data.countries

  if (countries.length === 0) {
    strapi.log.error(
      "[gateway-sync] Gateway returned 0 countries — circuit breaker: skipping sync",
    )
    return stats
  }

  strapi.log.info(
    `[gateway-sync] Fetched ${countries.length} countries from gateway`,
  )

  // Deduplicate and upsert continents
  const continentMap = new Map<string, string>()
  for (const country of countries) {
    if (!continentMap.has(country.continent.id)) {
      try {
        const { documentId } = await upsertByGatewayId(
          strapi,
          "api::continent.continent",
          country.continent.id,
          { name: getPrimaryValue(country.continent.name) },
          { locale: "en" },
        )
        continentMap.set(country.continent.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[gateway-sync] Failed to upsert continent ${country.continent.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  const seenCountryIds = new Set<string>()

  for (const country of countries) {
    seenCountryIds.add(country.id)

    try {
      const continentDocId = continentMap.get(country.continent.id)

      const { documentId: countryDocId, action } = await upsertByGatewayId(
        strapi,
        "api::country.country",
        country.id,
        {
          name: getPrimaryValue(country.name),
          population: country.population ?? undefined,
          latitude: country.latitude ?? undefined,
          longitude: country.longitude ?? undefined,
          flagPngSrc: country.flagPngSrc ?? undefined,
          flagWebpSrc: country.flagWebpSrc ?? undefined,
          languageCount: country.languageCount ?? undefined,
          languageHavingMediaCount:
            country.languageHavingMediaCount ?? undefined,
          continent: continentDocId
            ? { documentId: continentDocId }
            : undefined,
        },
        { locale: "en" },
      )

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++

      // Upsert CountryLanguage junctions
      for (const cl of country.countryLanguages) {
        try {
          const langDoc = await findByGatewayId(
            strapi,
            "api::language.language",
            cl.language.id,
            "en",
          )

          await upsertByGatewayId(
            strapi,
            "api::country-language.country-language",
            cl.id,
            {
              speakers: cl.speakers,
              displaySpeakers: cl.displaySpeakers ?? undefined,
              primary: cl.primary,
              suggested: cl.suggested,
              order: cl.order ?? undefined,
              language: langDoc
                ? { documentId: langDoc.documentId }
                : undefined,
              country: { documentId: countryDocId },
            },
          )
        } catch (error) {
          strapi.log.warn(
            `[gateway-sync] Failed to upsert country-language ${cl.id}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[gateway-sync] Failed to upsert country ${country.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Soft-delete pass
  stats.softDeleted = await softDeleteUnseen(
    strapi,
    "api::country.country",
    seenCountryIds,
    "en",
  )

  strapi.log.info(
    `[gateway-sync] Country sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
