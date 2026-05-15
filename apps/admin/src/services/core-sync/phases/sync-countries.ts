// Sync phase: countries
// Depends on: languages (for continent localized names)

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreCountrySchema } from "../schemas/country"
import { emptySyncStats } from "../types"
import { CORE_SYNC_TRANSACTION_OPTIONS } from "../transaction-options"
import {
  toLocalizedNames,
  toNameMap,
  type CoreLocalizedValue,
} from "../transforms"

const COUNTRIES_QUERY = `
  query Countries {
    countries {
      id
      population
      latitude
      longitude
      flagPngSrc
      flagWebpSrc
      languageCount
      languageHavingMediaCount
      continent { id name { value primary language { id bcp47 } } }
      name { value primary language { id bcp47 } }
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

type CoreCountry = {
  id: string
  name: CoreLocalizedValue[]
  population: number | null
  latitude: number | null
  longitude: number | null
  flagPngSrc: string | null
  flagWebpSrc: string | null
  languageCount: number | null
  languageHavingMediaCount: number | null
  continent: {
    id: string
    name: CoreLocalizedValue[]
  } | null
  countryLanguages: Array<{
    id: string
    speakers: number | null
    displaySpeakers: string | null
    primary: boolean | null
    suggested: boolean | null
    order: number | null
    language: { id: string }
  }>
}

export async function syncCountries({
  prisma,
  progress,
  since,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }
  const seenCoreIds = new Set<string>()
  const seenCountryLanguageCoreIds = new Set<string>()

  if (since) {
    console.info(
      JSON.stringify({
        event: "core-sync.country.incremental-ignored",
        reason: "core_countries_query_has_no_updated_at_filter",
      }),
    )
  }

  const result = await coreQuery<{ countries: CoreCountry[] }>(COUNTRIES_QUERY)

  const rawCountries = result.data?.countries ?? []
  const parsedCountries = CoreCountrySchema.array().safeParse(rawCountries)
  if (!parsedCountries.success) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.country.parse-error",
        issues: parsedCountries.error.issues,
      }),
    )
    progress.increment(rawCountries.length)
    return stats
  }

  const countries = parsedCountries.data
  if (countries.length === 0) {
    console.warn(
      JSON.stringify({
        event: "core-sync.country.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  for (const country of countries) {
    seenCoreIds.add(country.id)
  }

  progress.setTotal(countries.length)

  try {
    let pageUpdated = 0
    await prisma.$transaction(async (tx) => {
      const languages = await tx.language.findMany({
        select: { id: true, coreId: true },
      })
      const langMap = new Map(languages.map((l) => [l.coreId, l.id]))

      for (const country of countries) {
        let continentId: string | undefined
        if (country.continent) {
          const continent = await tx.continent.upsert({
            where: { coreId: country.continent.id },
            create: {
              coreId: country.continent.id,
              name: toNameMap(country.continent.name),
              syncedAt: new Date(),
            },
            update: {
              name: toNameMap(country.continent.name),
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
          continentId = continent.id
          const continentLocales = toLocalizedNames(country.continent.name)
          for (const localeRow of continentLocales) {
            await tx.continentLocale.upsert({
              where: {
                continentId_locale: {
                  continentId: continent.id,
                  locale: localeRow.locale,
                },
              },
              create: {
                continentId: continent.id,
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
          await tx.continentLocale.updateMany({
            where: {
              continentId: continent.id,
              source: "CORE",
              locale: { notIn: continentLocales.map((row) => row.locale) },
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          })
        }

        const countryRow = await tx.country.upsert({
          where: { coreId: country.id },
          create: {
            coreId: country.id,
            name: toNameMap(country.name),
            population: country.population,
            latitude: country.latitude,
            longitude: country.longitude,
            flagPngSrc: country.flagPngSrc,
            flagWebpSrc: country.flagWebpSrc,
            languageCount: country.languageCount,
            languageHavingMediaCount: country.languageHavingMediaCount,
            continentId: continentId ?? null,
            syncedAt: new Date(),
          },
          update: {
            name: toNameMap(country.name),
            population: country.population,
            latitude: country.latitude,
            longitude: country.longitude,
            flagPngSrc: country.flagPngSrc,
            flagWebpSrc: country.flagWebpSrc,
            languageCount: country.languageCount,
            languageHavingMediaCount: country.languageHavingMediaCount,
            continentId: continentId ?? null,
            syncedAt: new Date(),
            deletedAt: null,
          },
        })
        const countryLocales = toLocalizedNames(country.name)
        for (const localeRow of countryLocales) {
          await tx.countryLocale.upsert({
            where: {
              countryId_locale: {
                countryId: countryRow.id,
                locale: localeRow.locale,
              },
            },
            create: {
              countryId: countryRow.id,
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
        await tx.countryLocale.updateMany({
          where: {
            countryId: countryRow.id,
            source: "CORE",
            locale: { notIn: countryLocales.map((row) => row.locale) },
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        })

        for (const countryLanguage of country.countryLanguages) {
          const languageId = langMap.get(countryLanguage.language.id)
          if (!languageId) {
            stats.errors++
            console.warn(
              JSON.stringify({
                event: "core-sync.country-language.missing-language",
                countryCoreId: country.id,
                countryLanguageCoreId: countryLanguage.id,
                languageCoreId: countryLanguage.language.id,
              }),
            )
            continue
          }

          seenCountryLanguageCoreIds.add(countryLanguage.id)
          await tx.countryLanguage.upsert({
            where: {
              countryId_languageId: {
                countryId: countryRow.id,
                languageId,
              },
            },
            create: {
              coreId: countryLanguage.id,
              countryId: countryRow.id,
              languageId,
              speakers: countryLanguage.speakers,
              displaySpeakers: countryLanguage.displaySpeakers,
              primary: countryLanguage.primary,
              suggested: countryLanguage.suggested,
              order: countryLanguage.order,
              syncedAt: new Date(),
            },
            update: {
              coreId: countryLanguage.id,
              countryId: countryRow.id,
              languageId,
              speakers: countryLanguage.speakers,
              displaySpeakers: countryLanguage.displaySpeakers,
              primary: countryLanguage.primary,
              suggested: countryLanguage.suggested,
              order: countryLanguage.order,
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
        }
        pageUpdated++
      }
    }, CORE_SYNC_TRANSACTION_OPTIONS)
    stats.updated += pageUpdated
  } catch (err) {
    stats.errors++
    console.error(
      JSON.stringify({
        event: "core-sync.country.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  progress.increment(countries.length)

  if (stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.country.updateMany({
      where: {
        source: "CORE",
        coreId: { notIn: [...seenCoreIds] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })
    stats.softDeleted += result.count
    await prisma.countryLocale.updateMany({
      where: {
        source: "CORE",
        country: { coreId: { notIn: [...seenCoreIds] } },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })

    if (seenCountryLanguageCoreIds.size > 0) {
      const relationResult = await prisma.countryLanguage.updateMany({
        where: {
          source: "CORE",
          coreId: { notIn: [...seenCountryLanguageCoreIds] },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      })
      stats.softDeleted += relationResult.count
    }
  }

  return stats
}
