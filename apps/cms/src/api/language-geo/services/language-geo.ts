/**
 * Language Geo Service
 *
 * Returns all language, country, and continent data in a single SQL query,
 * bypassing GraphQL's N+1 problem (no DataLoader in Strapi v5).
 *
 * Critical: All queries filter `published_at IS NOT NULL` to avoid
 * counting Strapi v5 draft rows.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

type RawRow = {
  lang_core_id: string | null
  lang_document_id: string
  lang_name: string | null
  speakers: number | null
  country_core_id: string | null
  country_document_id: string
  country_name: string | null
  continent_core_id: string | null
  continent_document_id: string
  continent_name: string | null
}

type Continent = {
  id: string
  name: string
}

type Country = {
  id: string
  name: string
  continentId: string
}

type Language = {
  id: string
  englishLabel: string
  nativeLabel: string
  countryIds: string[]
  continentIds: string[]
  countrySpeakers: Record<string, number>
}

// Must match CmsLanguageGeo in apps/manager/src/app/api/languages/route.ts
type LanguageGeoResult = {
  continents: Continent[]
  countries: Country[]
  languages: Language[]
}

export async function queryLanguageGeo(
  knex: KnexInstance,
): Promise<LanguageGeoResult> {
  const sql = `
    SELECT
      l.core_id        AS lang_core_id,
      l.document_id    AS lang_document_id,
      l.name           AS lang_name,
      cl.speakers,
      c.core_id        AS country_core_id,
      c.document_id    AS country_document_id,
      c.name           AS country_name,
      ct.core_id       AS continent_core_id,
      ct.document_id   AS continent_document_id,
      ct.name          AS continent_name
    FROM country_languages cl
    JOIN country_languages_language_lnk cll ON cll.country_language_id = cl.id
    JOIN country_languages_country_lnk clc ON clc.country_language_id = cl.id
    JOIN languages l ON l.id = cll.language_id AND l.published_at IS NOT NULL
    JOIN countries c ON c.id = clc.country_id AND c.published_at IS NOT NULL
    JOIN countries_continent_lnk ccl ON ccl.country_id = c.id
    JOIN continents ct ON ct.id = ccl.continent_id AND ct.published_at IS NOT NULL
    WHERE cl.published_at IS NOT NULL
  `

  const result: { rows: RawRow[] } = await knex.raw(sql)

  // Aggregate raw rows into the denormalized shape the manager expects
  const continentMap = new Map<string, Continent>()
  const countryMap = new Map<string, Country>()
  const langCountryIds = new Map<string, Set<string>>()
  const langContinentIds = new Map<string, Set<string>>()
  const langCountrySpeakers = new Map<string, Record<string, number>>()
  const langNames = new Map<string, string>()

  for (const row of result.rows) {
    const continentId = String(
      row.continent_core_id ?? row.continent_document_id,
    )
    const countryId = String(row.country_core_id ?? row.country_document_id)
    const langId = String(row.lang_core_id ?? row.lang_document_id)

    // Collect unique continents
    if (!continentMap.has(continentId)) {
      continentMap.set(continentId, {
        id: continentId,
        name: String(row.continent_name ?? ""),
      })
    }

    // Collect unique countries
    if (!countryMap.has(countryId)) {
      countryMap.set(countryId, {
        id: countryId,
        name: String(row.country_name ?? ""),
        continentId,
      })
    }

    // Track language name
    if (!langNames.has(langId)) {
      langNames.set(langId, String(row.lang_name ?? langId))
    }

    // Track country IDs per language
    if (!langCountryIds.has(langId)) langCountryIds.set(langId, new Set())
    langCountryIds.get(langId)!.add(countryId)

    // Track continent IDs per language
    if (!langContinentIds.has(langId)) langContinentIds.set(langId, new Set())
    langContinentIds.get(langId)!.add(continentId)

    // Aggregate speakers per language per country
    const speakers = row.speakers ?? 0
    if (speakers > 0) {
      if (!langCountrySpeakers.has(langId)) langCountrySpeakers.set(langId, {})
      const existing = langCountrySpeakers.get(langId)!
      existing[countryId] = (existing[countryId] ?? 0) + speakers
    }
  }

  // Build languages array from all unique language IDs
  const languages: Language[] = []
  for (const [langId, name] of langNames) {
    languages.push({
      id: langId,
      englishLabel: name,
      nativeLabel: name,
      countryIds: Array.from(langCountryIds.get(langId) ?? []),
      continentIds: Array.from(langContinentIds.get(langId) ?? []),
      countrySpeakers: langCountrySpeakers.get(langId) ?? {},
    })
  }

  return {
    continents: Array.from(continentMap.values()),
    countries: Array.from(countryMap.values()),
    languages,
  }
}
