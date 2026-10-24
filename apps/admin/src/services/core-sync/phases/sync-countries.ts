// Sync phase: countries
// Depends on: languages (for continent localized names)

import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreCountrySchema } from "../schemas/country"
import { emptySyncStats } from "../types"
import { syncLanguages } from "./sync-languages"
import { toPgArray } from "@/db/pgvector"
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

type LocalizedNameRow = {
  id: string
  parentCoreId: string
  locale: string
  value: string
  primary: boolean
  order: number | null
}

type CountryLanguageWrite = {
  id: string
  coreId: string
  countryCoreId: string
  languageId: string
  speakers: number | null
  displaySpeakers: string | null
  primary: boolean | null
  suggested: boolean | null
  order: number | null
}

type MissingCountryLanguageRef = {
  countryCoreId: string
  countryLanguageCoreId: string
  languageCoreId: string
}

const fallbackProgress: ProgressReporter = {
  setTotal: () => {},
  increment: () => {},
}

function encodeJsonForPgArray(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64")
}

function uniqueBy<T>(rows: T[], keyFor: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [keyFor(row), row])).values()]
}

async function bulkUpsertContinents(
  prisma: PrismaClient,
  continents: ReadonlyArray<{
    id: string
    coreId: string
    nameBase64: string
  }>,
) {
  if (continents.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "continent" (
      "id",
      "core_id",
      "source",
      "name",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      convert_from(decode(input."name_base64", 'base64'), 'UTF8')::jsonb,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(continents.map((continent) => continent.id))}::text[],
      ${toPgArray(continents.map((continent) => continent.coreId))}::text[],
      ${toPgArray(continents.map((continent) => continent.nameBase64))}::text[]
    ) AS input("id", "core_id", "name_base64")
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "name"       = EXCLUDED."name",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
  `
}

async function bulkUpsertContinentLocales(
  prisma: PrismaClient,
  locales: ReadonlyArray<LocalizedNameRow>,
) {
  if (locales.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "continent_locale" (
      "id",
      "source",
      "continent_id",
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
      continent."id",
      input."locale",
      input."value",
      input."primary_text"::boolean,
      input."order_text"::int,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(locales.map((locale) => locale.id))}::text[],
      ${toPgArray(locales.map((locale) => locale.parentCoreId))}::text[],
      ${toPgArray(locales.map((locale) => locale.locale))}::text[],
      ${toPgArray(locales.map((locale) => locale.value))}::text[],
      ${toPgArray(locales.map((locale) => String(locale.primary)))}::text[],
      ${toPgArray(locales.map((locale) => locale.order?.toString() ?? null))}::text[]
    ) AS input(
      "id",
      "continent_core_id",
      "locale",
      "value",
      "primary_text",
      "order_text"
    )
    JOIN "continent" continent
      ON continent."core_id" = input."continent_core_id"
    ON CONFLICT ("continent_id", "locale")
    DO UPDATE SET
      "value"      = EXCLUDED."value",
      "primary"    = EXCLUDED."primary",
      "order"      = EXCLUDED."order",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
  `
}

async function bulkUpsertCountries(
  prisma: PrismaClient,
  countries: ReadonlyArray<{
    id: string
    coreId: string
    nameBase64: string
    population: number | null
    latitude: number | null
    longitude: number | null
    flagPngSrc: string | null
    flagWebpSrc: string | null
    languageCount: number | null
    languageHavingMediaCount: number | null
    continentCoreId: string | null
  }>,
) {
  if (countries.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "country" (
      "id",
      "core_id",
      "source",
      "name",
      "population",
      "latitude",
      "longitude",
      "flag_png_src",
      "flag_webp_src",
      "language_count",
      "language_having_media_count",
      "continent_id",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      convert_from(decode(input."name_base64", 'base64'), 'UTF8')::jsonb,
      input."population_text"::int,
      input."latitude_text"::double precision,
      input."longitude_text"::double precision,
      input."flag_png_src",
      input."flag_webp_src",
      input."language_count_text"::int,
      input."language_having_media_count_text"::int,
      continent."id",
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(countries.map((country) => country.id))}::text[],
      ${toPgArray(countries.map((country) => country.coreId))}::text[],
      ${toPgArray(countries.map((country) => country.nameBase64))}::text[],
      ${toPgArray(countries.map((country) => country.population?.toString() ?? null))}::text[],
      ${toPgArray(countries.map((country) => country.latitude?.toString() ?? null))}::text[],
      ${toPgArray(countries.map((country) => country.longitude?.toString() ?? null))}::text[],
      ${toPgArray(countries.map((country) => country.flagPngSrc))}::text[],
      ${toPgArray(countries.map((country) => country.flagWebpSrc))}::text[],
      ${toPgArray(countries.map((country) => country.languageCount?.toString() ?? null))}::text[],
      ${toPgArray(countries.map((country) => country.languageHavingMediaCount?.toString() ?? null))}::text[],
      ${toPgArray(countries.map((country) => country.continentCoreId))}::text[]
    ) AS input(
      "id",
      "core_id",
      "name_base64",
      "population_text",
      "latitude_text",
      "longitude_text",
      "flag_png_src",
      "flag_webp_src",
      "language_count_text",
      "language_having_media_count_text",
      "continent_core_id"
    )
    LEFT JOIN "continent" continent
      ON continent."core_id" = input."continent_core_id"
    ON CONFLICT ("core_id")
    DO UPDATE SET
      "name"                        = EXCLUDED."name",
      "population"                  = EXCLUDED."population",
      "latitude"                    = EXCLUDED."latitude",
      "longitude"                   = EXCLUDED."longitude",
      "flag_png_src"                = EXCLUDED."flag_png_src",
      "flag_webp_src"               = EXCLUDED."flag_webp_src",
      "language_count"              = EXCLUDED."language_count",
      "language_having_media_count" = EXCLUDED."language_having_media_count",
      "continent_id"                = EXCLUDED."continent_id",
      "synced_at"                   = EXCLUDED."synced_at",
      "updated_at"                  = EXCLUDED."updated_at",
      "deleted_at"                  = NULL
  `
}

async function bulkUpsertCountryLocales(
  prisma: PrismaClient,
  locales: ReadonlyArray<LocalizedNameRow>,
) {
  if (locales.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "country_locale" (
      "id",
      "source",
      "country_id",
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
      country."id",
      input."locale",
      input."value",
      input."primary_text"::boolean,
      input."order_text"::int,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(locales.map((locale) => locale.id))}::text[],
      ${toPgArray(locales.map((locale) => locale.parentCoreId))}::text[],
      ${toPgArray(locales.map((locale) => locale.locale))}::text[],
      ${toPgArray(locales.map((locale) => locale.value))}::text[],
      ${toPgArray(locales.map((locale) => String(locale.primary)))}::text[],
      ${toPgArray(locales.map((locale) => locale.order?.toString() ?? null))}::text[]
    ) AS input(
      "id",
      "country_core_id",
      "locale",
      "value",
      "primary_text",
      "order_text"
    )
    JOIN "country" country
      ON country."core_id" = input."country_core_id"
    ON CONFLICT ("country_id", "locale")
    DO UPDATE SET
      "value"      = EXCLUDED."value",
      "primary"    = EXCLUDED."primary",
      "order"      = EXCLUDED."order",
      "synced_at"  = EXCLUDED."synced_at",
      "updated_at" = EXCLUDED."updated_at",
      "deleted_at" = NULL
  `
}

async function bulkUpsertCountryLanguages(
  prisma: PrismaClient,
  countryLanguages: ReadonlyArray<CountryLanguageWrite>,
) {
  if (countryLanguages.length === 0) return

  await prisma.$executeRaw`
    INSERT INTO "country_language" (
      "id",
      "core_id",
      "source",
      "country_id",
      "language_id",
      "speakers",
      "display_speakers",
      "primary",
      "suggested",
      "order",
      "synced_at",
      "created_at",
      "updated_at"
    )
    SELECT
      input."id",
      input."core_id",
      'core'::"SourceTier",
      country."id",
      input."language_id",
      input."speakers_text"::int,
      input."display_speakers",
      input."primary_text"::boolean,
      input."suggested_text"::boolean,
      input."order_text"::int,
      NOW(),
      NOW(),
      NOW()
    FROM unnest(
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.id))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.coreId))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.countryCoreId))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.languageId))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.speakers?.toString() ?? null))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.displaySpeakers))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => (countryLanguage.primary == null ? null : String(countryLanguage.primary))))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => (countryLanguage.suggested == null ? null : String(countryLanguage.suggested))))}::text[],
      ${toPgArray(countryLanguages.map((countryLanguage) => countryLanguage.order?.toString() ?? null))}::text[]
    ) AS input(
      "id",
      "core_id",
      "country_core_id",
      "language_id",
      "speakers_text",
      "display_speakers",
      "primary_text",
      "suggested_text",
      "order_text"
    )
    JOIN "country" country
      ON country."core_id" = input."country_core_id"
    ON CONFLICT ("country_id", "language_id")
    DO UPDATE SET
      "core_id"          = EXCLUDED."core_id",
      "speakers"         = EXCLUDED."speakers",
      "display_speakers" = EXCLUDED."display_speakers",
      "primary"          = EXCLUDED."primary",
      "suggested"        = EXCLUDED."suggested",
      "order"            = EXCLUDED."order",
      "synced_at"        = EXCLUDED."synced_at",
      "updated_at"       = EXCLUDED."updated_at",
      "deleted_at"       = NULL
  `
}

async function loadLanguageMap(prisma: PrismaClient) {
  const languages = await prisma.language.findMany({
    select: { id: true, coreId: true },
  })
  return new Map(languages.map((l) => [l.coreId, l.id]))
}

function buildCountryLanguageRows(
  countries: readonly CoreCountry[],
  langMap: ReadonlyMap<string, string>,
) {
  const missingRefs: MissingCountryLanguageRef[] = []
  const rows: CountryLanguageWrite[] = []

  for (const country of countries) {
    for (const countryLanguage of country.countryLanguages) {
      const languageCoreId = countryLanguage.language.id
      const languageId = langMap.get(languageCoreId)
      if (!languageId) {
        missingRefs.push({
          countryCoreId: country.id,
          countryLanguageCoreId: countryLanguage.id,
          languageCoreId,
        })
        continue
      }

      rows.push({
        id: randomUUID(),
        coreId: countryLanguage.id,
        countryCoreId: country.id,
        languageId,
        speakers: countryLanguage.speakers,
        displaySpeakers: countryLanguage.displaySpeakers,
        primary: countryLanguage.primary,
        suggested: countryLanguage.suggested,
        order: countryLanguage.order,
      })
    }
  }

  return { rows, missingRefs }
}

async function repairMissingLanguagesForCountries(
  prisma: PrismaClient,
  missingRefs: readonly MissingCountryLanguageRef[],
) {
  if (missingRefs.length === 0) return { errors: 0 }

  console.warn(
    JSON.stringify({
      event: "core-sync.country-language.missing-language.fallback",
      missingLanguageCoreIds: [
        ...new Set(missingRefs.map((ref) => ref.languageCoreId)),
      ],
      missingCountryLanguageRefs: missingRefs.length,
    }),
  )

  const stats = await syncLanguages({
    prisma,
    progress: fallbackProgress,
  })

  return { errors: stats.errors }
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
    let langMap = await loadLanguageMap(prisma)
    const continentsByCoreId = new Map<
      string,
      { id: string; coreId: string; nameBase64: string }
    >()
    const continentLocales: LocalizedNameRow[] = []
    const countryLocales: LocalizedNameRow[] = []

    const countryRows = uniqueBy(
      countries.map((country) => {
        if (
          country.continent &&
          !continentsByCoreId.has(country.continent.id)
        ) {
          continentsByCoreId.set(country.continent.id, {
            id: randomUUID(),
            coreId: country.continent.id,
            nameBase64: encodeJsonForPgArray(toNameMap(country.continent.name)),
          })
          for (const localeRow of toLocalizedNames(country.continent.name)) {
            continentLocales.push({
              id: randomUUID(),
              parentCoreId: country.continent.id,
              locale: localeRow.locale,
              value: localeRow.value,
              primary: localeRow.primary,
              order: localeRow.order ?? null,
            })
          }
        }

        for (const localeRow of toLocalizedNames(country.name)) {
          countryLocales.push({
            id: randomUUID(),
            parentCoreId: country.id,
            locale: localeRow.locale,
            value: localeRow.value,
            primary: localeRow.primary,
            order: localeRow.order ?? null,
          })
        }

        return {
          id: randomUUID(),
          coreId: country.id,
          nameBase64: encodeJsonForPgArray(toNameMap(country.name)),
          population: country.population,
          latitude: country.latitude,
          longitude: country.longitude,
          flagPngSrc: country.flagPngSrc,
          flagWebpSrc: country.flagWebpSrc,
          languageCount: country.languageCount,
          languageHavingMediaCount: country.languageHavingMediaCount,
          continentCoreId: country.continent?.id ?? null,
        }
      }),
      (country) => country.coreId,
    )

    let { rows: countryLanguageRows, missingRefs } = buildCountryLanguageRows(
      countries,
      langMap,
    )

    if (missingRefs.length > 0) {
      const fallback = await repairMissingLanguagesForCountries(
        prisma,
        missingRefs,
      )
      stats.errors += fallback.errors
      if (fallback.errors === 0) {
        langMap = await loadLanguageMap(prisma)
        const rebuilt = buildCountryLanguageRows(countries, langMap)
        countryLanguageRows = rebuilt.rows
        missingRefs = rebuilt.missingRefs
      }
    }

    for (const missingRef of missingRefs) {
      stats.errors++
      console.warn(
        JSON.stringify({
          event: "core-sync.country-language.missing-language",
          countryCoreId: missingRef.countryCoreId,
          countryLanguageCoreId: missingRef.countryLanguageCoreId,
          languageCoreId: missingRef.languageCoreId,
        }),
      )
    }

    for (const countryLanguage of countryLanguageRows) {
      seenCountryLanguageCoreIds.add(countryLanguage.coreId)
    }

    await bulkUpsertContinents(prisma, [...continentsByCoreId.values()])
    await bulkUpsertContinentLocales(
      prisma,
      uniqueBy(
        continentLocales,
        (locale) => `${locale.parentCoreId}:${locale.locale}`,
      ),
    )
    await bulkUpsertCountries(prisma, countryRows)
    await bulkUpsertCountryLocales(
      prisma,
      uniqueBy(
        countryLocales,
        (locale) => `${locale.parentCoreId}:${locale.locale}`,
      ),
    )
    await bulkUpsertCountryLanguages(
      prisma,
      uniqueBy(
        countryLanguageRows,
        (countryLanguage) =>
          `${countryLanguage.countryCoreId}:${countryLanguage.languageId}`,
      ),
    )

    stats.updated += countryRows.length
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
