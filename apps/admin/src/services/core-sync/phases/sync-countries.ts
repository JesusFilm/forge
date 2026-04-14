// Sync phase: countries
// Depends on: languages (for continent localized names)

import type { PrismaClient } from "@prisma/client"
import type { SyncStats, ProgressReporter } from "../types"
import { coreQuery } from "../core-client"
import { emptySyncStats } from "../types"

const COUNTRIES_QUERY = `
  query Countries($offset: Int!, $limit: Int!) {
    countries(offset: $offset, limit: $limit) {
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
  name: Array<{ value: string; language: { bcp47: string } }>
  population: number | null
  latitude: number | null
  longitude: number | null
  flagPngSrc: string | null
  flagWebpSrc: string | null
  continent: {
    id: string
    name: Array<{ value: string; language: { bcp47: string } }>
  } | null
}

function toNameMap(
  names: Array<{ value: string; language: { bcp47: string } }>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of names) map[n.language.bcp47] = n.value
  return map
}

export async function syncCountries({
  prisma,
  progress,
}: {
  prisma: PrismaClient
  progress: ProgressReporter
  since?: string
}): Promise<SyncStats> {
  const stats = { ...emptySyncStats }
  const PAGE_SIZE = 500
  let offset = 0

  while (true) {
    const result = await coreQuery<{ countries: CoreCountry[] }>(
      COUNTRIES_QUERY,
      { offset, limit: PAGE_SIZE },
    )

    const countries = result.data?.countries ?? []
    if (countries.length === 0) break
    progress.setTotal(offset + countries.length)

    for (const c of countries) {
      try {
        // Upsert continent first if present
        let continentId: string | undefined
        if (c.continent) {
          const cont = await prisma.continent.upsert({
            where: { coreId: c.continent.id },
            create: {
              coreId: c.continent.id,
              name: toNameMap(c.continent.name),
            },
            update: { name: toNameMap(c.continent.name) },
          })
          continentId = cont.id
        }

        await prisma.country.upsert({
          where: { coreId: c.id },
          create: {
            coreId: c.id,
            name: toNameMap(c.name),
            population: c.population,
            latitude: c.latitude,
            longitude: c.longitude,
            flagPngSrc: c.flagPngSrc,
            flagWebpSrc: c.flagWebpSrc,
            ...(continentId ? { continentId } : {}),
            syncedAt: new Date(),
          },
          update: {
            name: toNameMap(c.name),
            population: c.population,
            latitude: c.latitude,
            longitude: c.longitude,
            flagPngSrc: c.flagPngSrc,
            flagWebpSrc: c.flagWebpSrc,
            ...(continentId ? { continentId } : {}),
            syncedAt: new Date(),
          },
        })
        stats.updated++
      } catch (err) {
        stats.errors++
        console.error(
          JSON.stringify({
            event: "core-sync.country.error",
            coreId: c.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
      progress.increment()
    }

    if (countries.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return stats
}
