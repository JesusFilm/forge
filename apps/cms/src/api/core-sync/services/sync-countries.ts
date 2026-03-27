import type { Core } from "@strapi/strapi"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  getPrimaryValue,
  softDeleteUnseen,
  buildCoreIdMap,
} from "./strapi-helpers"
import { bulkUpsertByCoreId } from "./bulk-upsert"

const COUNTRIES_QUERY = graphql(/* GraphQL */ `
  query SyncCountries {
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
          language {
            id
          }
        }
      }
      name(primary: true) {
        value
        primary
        language {
          id
        }
      }
      countryLanguages {
        id
        speakers
        displaySpeakers
        primary
        suggested
        order
        language {
          id
        }
      }
    }
  }
`)

export async function syncCountries(
  strapi: Core.Strapi,
  progress: ProgressReporter,
  _since?: string,
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  // Countries API has no updatedAt filter — always full sync
  strapi.log.info("[core-sync] Starting country sync (always full)")

  const { data } = await getCoreClient().query({ query: COUNTRIES_QUERY })
  const countries = data.countries

  if (countries.length === 0) {
    strapi.log.error(
      "[core-sync] Core API returned 0 countries — circuit breaker: skipping sync",
    )
    return stats
  }

  strapi.log.info(`[core-sync] Fetched ${countries.length} countries from core`)

  progress.setTotal(countries.length)

  // Pre-load language map
  const languageMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )

  // Bulk upsert continents (deduplicated)
  const continentMap = new Map<string, string>()
  for (const country of countries) {
    if (!continentMap.has(country.continent.id)) {
      continentMap.set(
        country.continent.id,
        getPrimaryValue(country.continent.name),
      )
    }
  }
  const continentRecords = [...continentMap.entries()].map(
    ([coreId, name]) => ({
      coreId,
      data: { name },
      links: {},
    }),
  )

  await bulkUpsertByCoreId(
    strapi,
    { tableName: "continents", locale: "en", linkConfigs: [] },
    continentRecords,
  )
  const continentDocMap = await buildCoreIdMap(
    strapi,
    "api::continent.continent",
    "en",
  )

  // Bulk upsert countries
  const seenCountryIds = new Set<string>()
  const countryRecords = countries.map((country) => {
    seenCountryIds.add(country.id)
    return {
      coreId: country.id,
      data: {
        name: getPrimaryValue(country.name),
        population: country.population ?? null,
        latitude: country.latitude ?? null,
        longitude: country.longitude ?? null,
        flag_png_src: country.flagPngSrc ?? null,
        flag_webp_src: country.flagWebpSrc ?? null,
        language_count: country.languageCount ?? null,
        language_having_media_count: country.languageHavingMediaCount ?? null,
      },
      links: {
        countries_continent_lnk: continentDocMap.get(country.continent.id),
      },
    }
  })

  const countryStats = await bulkUpsertByCoreId(
    strapi,
    {
      tableName: "countries",
      locale: "en",
      linkConfigs: [
        {
          linkTable: "countries_continent_lnk",
          sourceColumn: "country_id",
          targetTable: "continents",
          targetColumn: "continent_id",
          targetLocale: "en",
          orderColumn: "country_ord",
        },
      ],
    },
    countryRecords,
    progress,
  )
  stats.created = countryStats.created
  stats.updated = countryStats.updated
  stats.errors = countryStats.errors

  // Resolve country documentIds for junctions
  const countryDocMap = await buildCoreIdMap(
    strapi,
    "api::country.country",
    "en",
  )

  strapi.log.info(
    "[core-sync] Countries upserted, now syncing country-language junctions",
  )

  // Bulk upsert country-language junctions
  const junctionRecords = countries.flatMap((country) => {
    const countryDocId = countryDocMap.get(country.id)
    if (!countryDocId) return []
    return country.countryLanguages.map((cl) => ({
      coreId: cl.id,
      data: {
        speakers: cl.speakers,
        display_speakers: cl.displaySpeakers ?? null,
        primary: cl.primary,
        suggested: cl.suggested,
        order: cl.order ?? null,
      },
      links: {
        country_languages_language_lnk: languageMap.get(cl.language.id),
        country_languages_country_lnk: countryDocId,
      },
    }))
  })

  const junctionStats = await bulkUpsertByCoreId(
    strapi,
    {
      tableName: "country_languages",
      locale: "",
      linkConfigs: [
        {
          linkTable: "country_languages_language_lnk",
          sourceColumn: "country_language_id",
          targetTable: "languages",
          targetColumn: "language_id",
          targetLocale: "en",
          orderColumn: "country_language_ord",
        },
        {
          linkTable: "country_languages_country_lnk",
          sourceColumn: "country_language_id",
          targetTable: "countries",
          targetColumn: "country_id",
          targetLocale: "en",
          orderColumn: "country_language_ord",
        },
      ],
    },
    junctionRecords,
  )

  strapi.log.info(
    `[core-sync] Country-language junctions: ${junctionStats.created} created, ${junctionStats.updated} updated, ${junctionStats.errors} errors`,
  )

  stats.softDeleted = await softDeleteUnseen(
    strapi,
    "api::country.country",
    seenCountryIds,
    "en",
  )

  strapi.log.info(
    `[core-sync] Country sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
