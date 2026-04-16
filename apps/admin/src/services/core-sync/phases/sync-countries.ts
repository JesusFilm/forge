// Sync phase: countries
// Depends on: languages (for continent localized names)

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreCountrySchema } from "../schemas/country"
import { emptySyncStats } from "../types"

const COUNTRIES_QUERY = `
  query Countries($where: CountriesFilter) {
    countries(where: $where) {
      id
      name { value language { bcp47 } }
      population
      latitude
      longitude
      flagPngSrc
      flagWebpSrc
      continent { id name { value language { bcp47 } } }
    }
  }
`

type CoreCountry = {
  id: string
  name: Array<{ value: string; language: { bcp47?: string } }>
  population: number | null
  latitude: number | null
  longitude: number | null
  flagPngSrc: string | null
  flagWebpSrc: string | null
  continent: {
    id: string
    name: Array<{ value: string; language: { bcp47?: string } }>
  } | null
}

function toNameMap(
  names: Array<{ value: string; language: { bcp47?: string } }>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of names) {
    if (n.language.bcp47) {
      map[n.language.bcp47] = n.value
    }
  }
  return map
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

  const result = await coreQuery<{ countries: CoreCountry[] }>(
    COUNTRIES_QUERY,
    {
      where: since ? { updatedAt: { gte: since } } : undefined,
    },
  )

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
  if (countries.length === 0 && !since) {
    console.warn(
      JSON.stringify({
        event: "core-sync.country.soft-delete.skipped",
        reason: "empty_first_page",
      }),
    )
    return stats
  }

  if (countries.length === 0) {
    return stats
  }

  if (!since) {
    for (const country of countries) {
      seenCoreIds.add(country.id)
    }
  }

  progress.setTotal(countries.length)

  try {
    let pageUpdated = 0
    await prisma.$transaction(
      async (tx) => {
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
          }

          await tx.country.upsert({
            where: { coreId: country.id },
            create: {
              coreId: country.id,
              name: toNameMap(country.name),
              population: country.population,
              latitude: country.latitude,
              longitude: country.longitude,
              flagPngSrc: country.flagPngSrc,
              flagWebpSrc: country.flagWebpSrc,
              ...(continentId ? { continentId } : {}),
              syncedAt: new Date(),
            },
            update: {
              name: toNameMap(country.name),
              population: country.population,
              latitude: country.latitude,
              longitude: country.longitude,
              flagPngSrc: country.flagPngSrc,
              flagWebpSrc: country.flagWebpSrc,
              ...(continentId ? { continentId } : {}),
              syncedAt: new Date(),
              deletedAt: null,
            },
          })
          pageUpdated++
        }
      },
      { timeout: 5_000, maxWait: 2_000 },
    )
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

  if (!since && stats.errors === 0 && seenCoreIds.size > 0) {
    const result = await prisma.country.updateMany({
      where: {
        source: "CORE",
        coreId: { notIn: [...seenCoreIds] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })
    stats.softDeleted += result.count
  }

  return stats
}
