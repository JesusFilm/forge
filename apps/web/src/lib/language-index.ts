import { cache } from "react"
import { adminGraphql } from "@forge/admin-graphql"

import client from "@/lib/admin-client"

import {
  isPublicWatchLanguageSlug,
  publicWatchAudioLanguageSlugForLocale,
} from "./locale"
import { languageVideosIndexPath, tryAsLocaleSlug } from "./routes"

export type WatchLanguageIndexLanguage = {
  id: string
  coreId: string | null
  englishLabel: string
  nativeLabel: string
  publicSlug: string
  href: string
  bcp47: string | null
  speakerCount: number
  regionNames: string[]
  flagPngSrc: string | null
}

export type WatchLanguageGlobeLocation = {
  countryId: string
  countryName: string
  regionName: string
  latitude: number
  longitude: number
  speakers: number
  primary: boolean
  suggested: boolean
  order: number | null
}

type CountryLanguageRank = Pick<
  WatchLanguageGlobeLocation,
  "suggested" | "primary" | "speakers" | "order"
>

export type WatchLanguageIndexCountryGroup = {
  id: string
  coreId: string | null
  name: string
  flagPngSrc: string | null
  speakerCount: number
  languageSpeakerCounts: Record<string, number>
  languages: WatchLanguageIndexLanguage[]
}

export type WatchLanguageIndexRegion = {
  name: string
  languages: WatchLanguageIndexLanguage[]
  countries: WatchLanguageIndexCountryGroup[]
}

export type WatchLanguageIndex = {
  languages: WatchLanguageIndexLanguage[]
  regions: WatchLanguageIndexRegion[]
  globeLocationsByPublicSlug: Record<string, WatchLanguageGlobeLocation[]>
}

export type WatchLanguageIndexMetadataLanguage = {
  id?: string | null
  coreId?: string | null
  name?: unknown
  bcp47?: string | null
  slug?: string | null
}

export type WatchLanguageIndexMetadataCountryLanguage = {
  speakers?: number | null
  displaySpeakers?: string | null
  primary?: boolean | null
  suggested?: boolean | null
  order?: number | null
  language?: WatchLanguageIndexMetadataLanguage | null
}

export type WatchLanguageIndexMetadataCountry = {
  id?: string | null
  coreId?: string | null
  name?: unknown
  flagPngSrc?: string | null
  latitude?: number | null
  longitude?: number | null
  continent?: { id?: string | null; name?: unknown } | null
  countryLanguages?: readonly WatchLanguageIndexMetadataCountryLanguage[] | null
}

export type WatchLanguageIndexMetadata = {
  languages: WatchLanguageIndexMetadataLanguage[]
  countries: WatchLanguageIndexMetadataCountry[]
}

const WATCH_LANGUAGE_INDEX_METADATA_QUERY = adminGraphql(`
  query WatchLanguageIndexMetadata(
    $languageLimit: Int
    $languageOffset: Int
    $countryLimit: Int
    $countryOffset: Int
  ) {
    languages(limit: $languageLimit, offset: $languageOffset) {
      id
      coreId
      name
      bcp47
      slug
    }
    countries(limit: $countryLimit, offset: $countryOffset) {
      id
      coreId
      name
      flagPngSrc
      latitude
      longitude
      continent {
        id
        name
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
          coreId
          name
          bcp47
          slug
        }
      }
    }
  }
`)

const PAGE_SIZE = 500
const MAX_LANGUAGE_PAGES = 10
const OTHER_REGION_NAME = "Other"
const UNASSIGNED_COUNTRY_GROUP_NAME = "Unassigned"

export const getWatchLanguageIndex = cache(
  async (): Promise<WatchLanguageIndex> => {
    const metadata = await fetchWatchLanguageIndexMetadata()
    return buildWatchLanguageIndex(metadata)
  },
)

export async function getWatchLanguageIndexLanguage(
  publicSlug: string,
): Promise<WatchLanguageIndexLanguage | null> {
  const index = await getWatchLanguageIndex()
  return (
    index.languages.find((language) => language.publicSlug === publicSlug) ??
    null
  )
}

export function buildWatchLanguageIndex({
  languages,
  countries,
}: WatchLanguageIndexMetadata): WatchLanguageIndex {
  const metadataByKey = new Map<string, WatchLanguageIndexMetadataLanguage>()
  const regionNamesByKey = new Map<string, Set<string>>()
  const speakerCountByKey = new Map<string, number>()
  const countryLanguageLinks: Array<{
    country: WatchLanguageIndexMetadataCountry
    countryLanguage: WatchLanguageIndexMetadataCountryLanguage
    languageKey: string
    regionName: string
    countryName: string | null
  }> = []
  const flagCandidatesByKey = new Map<
    string,
    Array<{
      country: WatchLanguageIndexMetadataCountry
      countryLanguage: WatchLanguageIndexMetadataCountryLanguage
    }>
  >()
  const globeLocationsByKey = new Map<string, WatchLanguageGlobeLocation[]>()

  for (const language of languages) {
    const key = languageMetadataKey(language)
    if (key) metadataByKey.set(key, language)
  }

  for (const country of countries) {
    const regionName =
      localizedName(country.continent?.name) ?? OTHER_REGION_NAME
    const countryName = localizedName(country.name)

    for (const countryLanguage of country.countryLanguages ?? []) {
      const language = countryLanguage.language
      if (!language) continue

      const key = languageMetadataKey(language)
      if (!key) continue

      metadataByKey.set(key, language)
      countryLanguageLinks.push({
        country,
        countryLanguage,
        languageKey: key,
        regionName,
        countryName,
      })

      const speakers = countryLanguageSpeakerCount(countryLanguage)
      if (speakers > 0) {
        speakerCountByKey.set(key, (speakerCountByKey.get(key) ?? 0) + speakers)
      }

      const regions = regionNamesByKey.get(key) ?? new Set<string>()
      regions.add(regionName)
      regionNamesByKey.set(key, regions)

      if (country.flagPngSrc) {
        const candidates = flagCandidatesByKey.get(key) ?? []
        candidates.push({ country, countryLanguage })
        flagCandidatesByKey.set(key, candidates)
      }

      const latitude = validLatitude(country.latitude)
      const longitude = validLongitude(country.longitude)
      if (latitude != null && longitude != null && countryName) {
        const locations = globeLocationsByKey.get(key) ?? []
        locations.push({
          countryId: country.id ?? country.coreId ?? countryName,
          countryName,
          regionName,
          latitude,
          longitude,
          speakers,
          primary: countryLanguage.primary === true,
          suggested: countryLanguage.suggested === true,
          order: countryLanguage.order ?? null,
        })
        globeLocationsByKey.set(key, locations)
      }
    }
  }

  const byPublicSlug = new Map<string, WatchLanguageIndexLanguage>()
  const publicSlugByMetadataKey = new Map<string, string>()
  const globeLocationsByPublicSlug = new Map<
    string,
    WatchLanguageGlobeLocation[]
  >()

  for (const [key, language] of metadataByKey) {
    const entry = languageIndexEntryFromMetadata({
      language,
      regionNames: [...(regionNamesByKey.get(key) ?? [])],
      speakerCount: speakerCountByKey.get(key) ?? 0,
      flagPngSrc: bestFlagPngSrc(flagCandidatesByKey.get(key) ?? []),
    })
    if (!entry) continue

    publicSlugByMetadataKey.set(key, entry.publicSlug)
    globeLocationsByPublicSlug.set(
      entry.publicSlug,
      rankGlobeLocations([
        ...(globeLocationsByPublicSlug.get(entry.publicSlug) ?? []),
        ...(globeLocationsByKey.get(key) ?? []),
      ]),
    )
    const existing = byPublicSlug.get(entry.publicSlug)
    if (!existing) {
      byPublicSlug.set(entry.publicSlug, entry)
      continue
    }

    byPublicSlug.set(entry.publicSlug, {
      ...existing,
      coreId: existing.coreId ?? entry.coreId,
      nativeLabel:
        existing.nativeLabel === existing.englishLabel
          ? entry.nativeLabel
          : existing.nativeLabel,
      speakerCount: existing.speakerCount + entry.speakerCount,
      regionNames: [
        ...new Set([...existing.regionNames, ...entry.regionNames]),
      ].sort((a, b) => a.localeCompare(b)),
      flagPngSrc: existing.flagPngSrc ?? entry.flagPngSrc,
    })
  }

  const sortedLanguages = [...byPublicSlug.values()].sort(
    compareLanguagesBySpeakerCount,
  )

  const groups = new Map<string, WatchLanguageIndexLanguage[]>()
  for (const language of sortedLanguages) {
    const regionNames =
      language.regionNames.length > 0
        ? language.regionNames
        : [OTHER_REGION_NAME]
    for (const regionName of regionNames) {
      groups.set(regionName, [...(groups.get(regionName) ?? []), language])
    }
  }
  const countryGroupsByRegion = buildCountryGroupsByRegion({
    countryLanguageLinks,
    groups,
    languagesByPublicSlug: byPublicSlug,
    publicSlugByMetadataKey,
  })

  return {
    languages: sortedLanguages,
    globeLocationsByPublicSlug: Object.fromEntries(globeLocationsByPublicSlug),
    regions: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, groupLanguages]) => ({
        name,
        languages: [...groupLanguages].sort(compareLanguagesBySpeakerCount),
        countries: countryGroupsByRegion.get(name) ?? [],
      })),
  }
}

async function fetchWatchLanguageIndexMetadata(): Promise<WatchLanguageIndexMetadata> {
  const languages: WatchLanguageIndexMetadataLanguage[] = []
  let countries: WatchLanguageIndexMetadataCountry[] = []

  for (let page = 0; page < MAX_LANGUAGE_PAGES; page += 1) {
    const result = await client.query({
      query: WATCH_LANGUAGE_INDEX_METADATA_QUERY,
      variables: {
        languageLimit: PAGE_SIZE,
        languageOffset: page * PAGE_SIZE,
        countryLimit: page === 0 ? PAGE_SIZE : 0,
        countryOffset: 0,
      },
      fetchPolicy: "no-cache",
    })

    if (result.error) {
      throw result.error
    }

    const pageLanguages = compact(result.data?.languages)
    languages.push(...pageLanguages)

    if (page === 0) {
      countries = compact(result.data?.countries)
    }

    if (pageLanguages.length < PAGE_SIZE) break
  }

  return { languages, countries }
}

function languageIndexEntryFromMetadata({
  language,
  regionNames,
  speakerCount,
  flagPngSrc,
}: {
  language: WatchLanguageIndexMetadataLanguage
  regionNames: string[]
  speakerCount: number
  flagPngSrc: string | null
}): WatchLanguageIndexLanguage | null {
  const englishLabel = localizedName(language.name)
  if (!englishLabel) return null

  const publicSlug = publicSlugForLanguage(language)
  const localeSlug = publicSlug ? tryAsLocaleSlug(publicSlug) : null
  if (!publicSlug || !localeSlug) return null

  return {
    id: language.id ?? publicSlug,
    coreId: language.coreId ?? null,
    englishLabel,
    nativeLabel: nativeName(language.name, language.bcp47) ?? englishLabel,
    publicSlug,
    href: languageVideosIndexPath(localeSlug),
    bcp47: language.bcp47 ?? null,
    speakerCount,
    regionNames:
      regionNames.length > 0
        ? [...new Set(regionNames)].sort((a, b) => a.localeCompare(b))
        : [],
    flagPngSrc,
  }
}

function rankGlobeLocations(
  locations: WatchLanguageGlobeLocation[],
): WatchLanguageGlobeLocation[] {
  const unique = new Map<string, WatchLanguageGlobeLocation>()
  for (const location of locations) {
    const coordinateKey = `${location.latitude}:${location.longitude}`
    const existing = unique.get(coordinateKey)
    if (
      !existing ||
      compareCountryLanguageRank(location, existing) < 0 ||
      (compareCountryLanguageRank(location, existing) === 0 &&
        location.countryName.localeCompare(existing.countryName) < 0)
    ) {
      unique.set(coordinateKey, location)
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      compareCountryLanguageRank(a, b) ||
      a.countryName.localeCompare(b.countryName),
  )
}

function compareCountryLanguageRank(
  a: CountryLanguageRank,
  b: CountryLanguageRank,
): number {
  return (
    Number(b.suggested) - Number(a.suggested) ||
    Number(b.primary) - Number(a.primary) ||
    b.speakers - a.speakers ||
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
}

export function languageGlobeCoverage(index: WatchLanguageIndex): {
  eligibleLanguages: number
  regions: string[]
  duplicateCoordinatePairs: number
} {
  const eligible = index.languages.filter(
    (language) =>
      (index.globeLocationsByPublicSlug[language.publicSlug]?.length ?? 0) > 0,
  )
  const regions = new Set<string>()
  const coordinateCounts = new Map<string, number>()
  for (const language of eligible) {
    const locations =
      index.globeLocationsByPublicSlug[language.publicSlug] ?? []
    for (const location of locations) regions.add(location.regionName)
    const first = locations[0]
    if (first) {
      const key = `${first.latitude.toFixed(4)}:${first.longitude.toFixed(4)}`
      coordinateCounts.set(key, (coordinateCounts.get(key) ?? 0) + 1)
    }
  }
  return {
    eligibleLanguages: eligible.length,
    regions: [...regions].sort((a, b) => a.localeCompare(b)),
    duplicateCoordinatePairs: [...coordinateCounts.values()].reduce(
      (total, count) => total + (count > 1 ? (count * (count - 1)) / 2 : 0),
      0,
    ),
  }
}

function validLatitude(value: number | null | undefined): number | null {
  return Number.isFinite(value) && value != null && value >= -90 && value <= 90
    ? value
    : null
}

function validLongitude(value: number | null | undefined): number | null {
  return Number.isFinite(value) &&
    value != null &&
    value >= -180 &&
    value <= 180
    ? value
    : null
}

function bestFlagPngSrc(
  candidates: Array<{
    country: WatchLanguageIndexMetadataCountry
    countryLanguage: WatchLanguageIndexMetadataCountryLanguage
  }>,
): string | null {
  const [best] = [...candidates].sort((a, b) => {
    const aLanguage = a.countryLanguage
    const bLanguage = b.countryLanguage
    return compareCountryLanguageRank(
      {
        suggested: aLanguage.suggested === true,
        primary: aLanguage.primary === true,
        speakers: countryLanguageSpeakerCount(aLanguage),
        order: aLanguage.order ?? null,
      },
      {
        suggested: bLanguage.suggested === true,
        primary: bLanguage.primary === true,
        speakers: countryLanguageSpeakerCount(bLanguage),
        order: bLanguage.order ?? null,
      },
    )
  })

  return best?.country.flagPngSrc ?? null
}

export function compareLanguagesBySpeakerCount(
  a: WatchLanguageIndexLanguage,
  b: WatchLanguageIndexLanguage,
): number {
  return (
    b.speakerCount - a.speakerCount ||
    a.englishLabel.localeCompare(b.englishLabel)
  )
}

function buildCountryGroupsByRegion({
  countryLanguageLinks,
  groups,
  languagesByPublicSlug,
  publicSlugByMetadataKey,
}: {
  countryLanguageLinks: Array<{
    country: WatchLanguageIndexMetadataCountry
    countryLanguage: WatchLanguageIndexMetadataCountryLanguage
    languageKey: string
    regionName: string
    countryName: string | null
  }>
  groups: Map<string, WatchLanguageIndexLanguage[]>
  languagesByPublicSlug: Map<string, WatchLanguageIndexLanguage>
  publicSlugByMetadataKey: Map<string, string>
}): Map<string, WatchLanguageIndexCountryGroup[]> {
  const countryGroupsByRegion = new Map<
    string,
    Map<
      string,
      {
        id: string
        coreId: string | null
        name: string
        flagPngSrc: string | null
        speakerCount: number
        languagesByPublicSlug: Map<
          string,
          {
            language: WatchLanguageIndexLanguage
            speakerCount: number
          }
        >
      }
    >
  >()
  const linkedLanguageSlugsByRegion = new Map<string, Set<string>>()

  for (const link of countryLanguageLinks) {
    const publicSlug = publicSlugByMetadataKey.get(link.languageKey)
    const language = publicSlug
      ? languagesByPublicSlug.get(publicSlug)
      : undefined
    if (!language) continue

    const countryName = link.countryName ?? UNASSIGNED_COUNTRY_GROUP_NAME
    const countryKey =
      link.country.coreId ??
      link.country.id ??
      `${link.regionName}:${countryName}`
    const regionCountryGroups =
      countryGroupsByRegion.get(link.regionName) ?? new Map()
    const group = regionCountryGroups.get(countryKey) ?? {
      id: link.country.id ?? countryKey,
      coreId: link.country.coreId ?? null,
      name: countryName,
      flagPngSrc: link.country.flagPngSrc ?? null,
      speakerCount: 0,
      languagesByPublicSlug: new Map<
        string,
        {
          language: WatchLanguageIndexLanguage
          speakerCount: number
        }
      >(),
    }

    const effectiveSpeakerCount = countryLanguageSpeakerCount(
      link.countryLanguage,
    )
    group.speakerCount += effectiveSpeakerCount
    const existingLanguage = group.languagesByPublicSlug.get(
      language.publicSlug,
    )
    group.languagesByPublicSlug.set(language.publicSlug, {
      language,
      speakerCount:
        (existingLanguage?.speakerCount ?? 0) + effectiveSpeakerCount,
    })
    regionCountryGroups.set(countryKey, group)
    countryGroupsByRegion.set(link.regionName, regionCountryGroups)

    const linkedLanguageSlugs =
      linkedLanguageSlugsByRegion.get(link.regionName) ?? new Set<string>()
    linkedLanguageSlugs.add(language.publicSlug)
    linkedLanguageSlugsByRegion.set(link.regionName, linkedLanguageSlugs)
  }

  for (const [regionName, regionLanguages] of groups) {
    const linkedLanguageSlugs =
      linkedLanguageSlugsByRegion.get(regionName) ?? new Set<string>()
    const unassignedLanguages = regionLanguages.filter(
      (language) => !linkedLanguageSlugs.has(language.publicSlug),
    )
    if (unassignedLanguages.length === 0) continue

    const regionCountryGroups =
      countryGroupsByRegion.get(regionName) ?? new Map()
    regionCountryGroups.set(`${regionName}:unassigned`, {
      id: `${regionName}:unassigned`,
      coreId: null,
      name: UNASSIGNED_COUNTRY_GROUP_NAME,
      flagPngSrc: null,
      speakerCount: 0,
      languagesByPublicSlug: new Map(
        unassignedLanguages.map((language) => [
          language.publicSlug,
          { language, speakerCount: 0 },
        ]),
      ),
    })
    countryGroupsByRegion.set(regionName, regionCountryGroups)
  }

  return new Map(
    [...countryGroupsByRegion.entries()].map(([regionName, countryGroups]) => [
      regionName,
      [...countryGroups.values()]
        .map((group) => ({
          id: group.id,
          coreId: group.coreId,
          name: group.name,
          flagPngSrc: group.flagPngSrc,
          speakerCount: group.speakerCount,
          languageSpeakerCounts: Object.fromEntries(
            [...group.languagesByPublicSlug.entries()].map(
              ([publicSlug, entry]) => [publicSlug, entry.speakerCount],
            ),
          ),
          languages: [...group.languagesByPublicSlug.values()]
            .sort(compareCountryLanguageEntries)
            .map((entry) => entry.language),
        }))
        .sort(compareCountryGroups),
    ]),
  )
}

function compareCountryGroups(
  a: WatchLanguageIndexCountryGroup,
  b: WatchLanguageIndexCountryGroup,
): number {
  if (a.name === UNASSIGNED_COUNTRY_GROUP_NAME) return 1
  if (b.name === UNASSIGNED_COUNTRY_GROUP_NAME) return -1
  return a.name.localeCompare(b.name)
}

function compareCountryLanguageEntries(
  a: { language: WatchLanguageIndexLanguage; speakerCount: number },
  b: { language: WatchLanguageIndexLanguage; speakerCount: number },
): number {
  return (
    b.speakerCount - a.speakerCount ||
    compareLanguagesBySpeakerCount(a.language, b.language)
  )
}

function speakerCount(value: number | null | undefined): number {
  return Number.isFinite(value) && value != null && value > 0 ? value : 0
}

function countryLanguageSpeakerCount(
  countryLanguage: WatchLanguageIndexMetadataCountryLanguage,
): number {
  // Some Core rows use large raw `speakers` sentinel values for ordering.
  // `displaySpeakers` carries the real count when present.
  return (
    parseDisplaySpeakers(countryLanguage.displaySpeakers) ??
    speakerCount(countryLanguage.speakers)
  )
}

function parseDisplaySpeakers(value: string | null | undefined): number | null {
  if (!value) return null

  const normalized = value.trim().replaceAll(",", "")
  if (!normalized || normalized === "0") return null

  const suffixMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*([kKmMbB])$/)
  if (suffixMatch) {
    const amount = Number(suffixMatch[1])
    const suffix = suffixMatch[2]?.toLowerCase()
    const multiplier =
      suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1_000_000_000
    return Number.isFinite(amount) && amount > 0
      ? Math.round(amount * multiplier)
      : null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function publicSlugForLanguage(
  language: WatchLanguageIndexMetadataLanguage,
): string | null {
  if (language.slug && isPublicWatchLanguageSlug(language.slug)) {
    return language.slug
  }
  if (!language.bcp47) return null
  return (
    publicWatchAudioLanguageSlugForLocale(language.bcp47) ??
    publicWatchAudioLanguageSlugForLocale(language.bcp47.split("-")[0] ?? "")
  )
}

function languageMetadataKey(
  language: WatchLanguageIndexMetadataLanguage,
): string | null {
  if (language.coreId) return `core:${language.coreId}`
  if (language.id) return `id:${language.id}`
  const name = localizedName(language.name)
  return name ? `name:${name.toLowerCase()}` : null
}

function nativeName(
  name: unknown,
  bcp47: string | null | undefined,
): string | null {
  if (!name || typeof name !== "object") return null
  const names = name as Record<string, unknown>
  const candidates = [bcp47, bcp47?.split("-")[0], "native", "local"].filter(
    (candidate): candidate is string => candidate != null,
  )

  for (const candidate of candidates) {
    const value = names[candidate]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function localizedName(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  if (!value || typeof value !== "object") return null
  const names = value as Record<string, unknown>
  const preferred = names.en ?? names.eng ?? names["en-US"]
  if (typeof preferred === "string" && preferred.trim().length > 0) {
    return preferred.trim()
  }
  for (const candidate of Object.values(names)) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }
  return null
}

function compact<T>(
  values: readonly (T | null | undefined)[] | null | undefined,
): T[] {
  if (!Array.isArray(values)) return []
  return values.filter((value): value is T => value != null)
}
