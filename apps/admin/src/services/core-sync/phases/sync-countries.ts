// Sync phase: countries
// Depends on: languages (for continent localized names)
//
// Two bulk INSERT … ON CONFLICT DO UPDATE statements per run — one for
// the deduped continent set in the batch, then one for the countries
// (with continent_id resolved via an in-memory map). See
// bulk-upsert.ts header for the prod failure mode this replaces.

import { Prisma, type PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { CoreCountrySchema } from "../schemas/country"
import { emptySyncStats } from "../types"
import { jsonbParam, newRowId } from "../bulk-upsert"

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
    const now = new Date()

    // ---- Step 1: bulk-upsert the deduped continent set in this batch.
    // We need the resulting (core_id, id) pairs to look up continent_id
    // when bulk-upserting the countries below. RETURNING gives them
    // back in one round-trip.
    const continentByCoreId = new Map<
      string,
      { name: Record<string, string> }
    >()
    for (const country of countries) {
      if (country.continent && !continentByCoreId.has(country.continent.id)) {
        continentByCoreId.set(country.continent.id, {
          name: toNameMap(country.continent.name),
        })
      }
    }

    const coreIdToContinentId = new Map<string, string>()
    if (continentByCoreId.size > 0) {
      const continentTuples: Prisma.Sql[] = []
      for (const [coreId, { name }] of continentByCoreId) {
        // Column order: id, core_id, name, synced_at, updated_at
        continentTuples.push(
          Prisma.sql`(${newRowId()}, ${coreId}, ${jsonbParam(name)}, ${now}, ${now})`,
        )
      }

      const continentRows = await prisma.$queryRaw<
        Array<{ id: string; core_id: string }>
      >(
        Prisma.sql`
          INSERT INTO "continent" ("id", "core_id", "name", "synced_at", "updated_at")
          VALUES ${Prisma.join(continentTuples, ", ")}
          ON CONFLICT ("core_id") DO UPDATE SET
            "name"       = EXCLUDED."name",
            "synced_at"  = EXCLUDED."synced_at",
            "updated_at" = EXCLUDED."updated_at",
            "deleted_at" = NULL
          RETURNING "id", "core_id"
        `,
      )
      for (const row of continentRows) {
        coreIdToContinentId.set(row.core_id, row.id)
      }
    }

    // ---- Step 2: bulk-upsert countries, resolving continent_id from
    // the map populated above. Continent FK is nullable — countries
    // whose `continent` was missing from the Core payload land with
    // NULL.
    const countryTuples = countries.map((country) => {
      const continentId = country.continent
        ? (coreIdToContinentId.get(country.continent.id) ?? null)
        : null
      // Column order: id, core_id, name, population, latitude, longitude,
      // flag_png_src, flag_webp_src, continent_id, synced_at, updated_at
      return Prisma.sql`(${newRowId()}, ${country.id}, ${jsonbParam(toNameMap(country.name))}, ${country.population}, ${country.latitude}, ${country.longitude}, ${country.flagPngSrc}, ${country.flagWebpSrc}, ${continentId}, ${now}, ${now})`
    })

    const affected = await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "country" (
          "id", "core_id", "name", "population", "latitude", "longitude",
          "flag_png_src", "flag_webp_src", "continent_id", "synced_at", "updated_at"
        )
        VALUES ${Prisma.join(countryTuples, ", ")}
        ON CONFLICT ("core_id") DO UPDATE SET
          "name"          = EXCLUDED."name",
          "population"    = EXCLUDED."population",
          "latitude"      = EXCLUDED."latitude",
          "longitude"     = EXCLUDED."longitude",
          "flag_png_src"  = EXCLUDED."flag_png_src",
          "flag_webp_src" = EXCLUDED."flag_webp_src",
          "continent_id"  = EXCLUDED."continent_id",
          "synced_at"     = EXCLUDED."synced_at",
          "updated_at"    = EXCLUDED."updated_at",
          "deleted_at"    = NULL
      `,
    )
    stats.updated += Number(affected)
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
