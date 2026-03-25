import type { Core } from "@strapi/strapi"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  getPrimaryValue,
  formatError,
  buildCoreIdMap,
  upsertByCoreId,
  softDeleteUnseen,
  clearableRelation,
} from "./strapi-helpers"

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

  // Pre-load language map to avoid N+1 lookups in junction loop
  const languageMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )

  // Deduplicate and upsert continents
  const continentMap = new Map<string, string>()
  for (const country of countries) {
    if (!continentMap.has(country.continent.id)) {
      try {
        const { documentId } = await upsertByCoreId(
          strapi,
          "api::continent.continent",
          country.continent.id,
          { name: getPrimaryValue(country.continent.name) },
          { locale: "en" },
        )
        continentMap.set(country.continent.id, documentId)
      } catch (error) {
        strapi.log.warn(
          `[core-sync] Failed to upsert continent ${country.continent.id}: ${formatError(error)}`,
        )
      }
    }
  }

  const seenCountryIds = new Set<string>()
  const countryDocMap = new Map<string, string>()

  // First pass: upsert all countries
  for (const country of countries) {
    seenCountryIds.add(country.id)

    try {
      const continentDocId = continentMap.get(country.continent.id)

      const { documentId: countryDocId, action } = await upsertByCoreId(
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
          continent: clearableRelation(continentDocId),
        },
        { locale: "en" },
      )

      countryDocMap.set(country.id, countryDocId)

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[core-sync] Failed to upsert country ${country.id}: ${formatError(error)}`,
      )
    }

    progress.increment()
  }

  strapi.log.info(
    "[core-sync] Countries upserted, now syncing country-language junctions",
  )

  // Second pass: upsert all country-language junctions
  for (const country of countries) {
    const countryDocId = countryDocMap.get(country.id)
    if (!countryDocId) continue

    for (const cl of country.countryLanguages) {
      try {
        const langDocId = languageMap.get(cl.language.id)

        await upsertByCoreId(
          strapi,
          "api::country-language.country-language",
          cl.id,
          {
            speakers: cl.speakers,
            displaySpeakers: cl.displaySpeakers ?? undefined,
            primary: cl.primary,
            suggested: cl.suggested,
            order: cl.order ?? undefined,
            language: clearableRelation(langDocId),
            country: countryDocId,
          },
        )
      } catch (error) {
        strapi.log.warn(
          `[core-sync] Failed to upsert country-language ${cl.id}: ${formatError(error)}`,
        )
      }
    }
  }

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
