import {
  DEFAULT_LOCALE,
  isPublicWatchLanguageSlug,
  parseAcceptLanguage,
  publicWatchAudioLanguageSlugForLocale,
  resolveWatchLocaleIdentity,
  type UiLocale,
} from "./locale"

export type SearchLanguageResolutionSource =
  | "explicit-selection"
  | "route"
  | "accept-language"
  | "fallback"

export type SearchLanguageOption = {
  coreId?: string | null
  englishName: string
  nativeName: string | null
  bcp47: string | null
  publicSlug: string | null
  regionNames: string[]
  facetCount?: number
}

export type SearchLanguageRegionGroup = {
  regionName: string
  languages: SearchLanguageOption[]
}

export type SearchLanguageCountrySuggestion = {
  countryName: string
  flagPngSrc: string | null
  languages: SearchLanguageOption[]
}

export type SearchLanguageMetadataLanguage = {
  id?: string | null
  coreId?: string | null
  name?: unknown
  bcp47?: string | null
  slug?: string | null
}

export type SearchLanguageMetadataCountryLanguage = {
  speakers?: number | null
  primary?: boolean | null
  suggested?: boolean | null
  order?: number | null
  language?: SearchLanguageMetadataLanguage | null
}

export type SearchLanguageMetadataCountry = {
  id?: string | null
  coreId?: string | null
  name?: unknown
  flagPngSrc?: string | null
  continent?: { name?: unknown } | null
  countryLanguages?: readonly SearchLanguageMetadataCountryLanguage[] | null
}

export type BuildSearchLanguageOptionsInput = {
  languages: readonly SearchLanguageMetadataLanguage[]
  countries?: readonly SearchLanguageMetadataCountry[]
  availableLanguageFacets?: Record<string, number>
  countryCode?: string | null
  countryName?: string | null
}

export type BuildSearchLanguageOptionsResult = {
  options: SearchLanguageOption[]
  countrySuggestion: SearchLanguageCountrySuggestion | null
}

export type SearchLanguageResolution = {
  locale: UiLocale
  publicSlug: string
  englishName: string | null
  source: SearchLanguageResolutionSource
}

export type ResolveSearchLanguageInput = {
  selectedEnglishNames?: readonly string[]
  explicitSlug?: string | null
  routeLanguageSlug?: string | null
  acceptLanguage?: string | null
  languageOptions?: readonly SearchLanguageOption[]
}

const ENGLISH_PUBLIC_SLUG = "english"

const OTHER_REGION_NAME = "Other"
export const MAX_SEARCH_LANGUAGE_FILTERS = 8
export const MAX_SEARCH_LANGUAGE_NAME_LENGTH = 100

export function normalizeSearchLanguageName(value: string): string {
  return value.replace(/,/g, "").trim().toLowerCase().replace(/\s+/g, " ")
}

export function normalizeSearchLanguageEnglishNames(
  values: readonly string[] = [],
): string[] {
  const normalized = values.flatMap((value) => {
    const trimmed = value.trim()
    if (trimmed.length === 0) return []
    return [trimmed.slice(0, MAX_SEARCH_LANGUAGE_NAME_LENGTH)]
  })
  return [...new Set(normalized)].slice(0, MAX_SEARCH_LANGUAGE_FILTERS)
}

export function normalizeLanguageSearchToken(language: string): string {
  return language.toLowerCase().split(",")[0]?.trim() ?? ""
}

export function stripLanguageFromSearchQuery(
  language: string,
  query: string,
): string {
  const normalizedLanguage = normalizeLanguageSearchToken(language)
  if (normalizedLanguage.length === 0) return query
  if (!query.toLowerCase().includes(normalizedLanguage)) return query
  return query.replace(new RegExp(normalizedLanguage, "gi"), "").trim()
}

export function publicSlugForLocale(locale: string): string {
  return publicWatchAudioLanguageSlugForLocale(locale) ?? ENGLISH_PUBLIC_SLUG
}

function optionForEnglishName(
  englishName: string,
  options: readonly SearchLanguageOption[] = [],
): SearchLanguageOption | null {
  const normalized = normalizeSearchLanguageName(englishName)
  return (
    options.find(
      (option) =>
        normalizeSearchLanguageName(option.englishName) === normalized,
    ) ?? null
  )
}

export function findSearchLanguageOptionByEnglishName(
  englishName: string,
  options: readonly SearchLanguageOption[] = [],
): SearchLanguageOption | null {
  return optionForEnglishName(englishName, options)
}

export function findQueryNamedLanguageOption(
  query: string,
  languageOptions: readonly SearchLanguageOption[],
): SearchLanguageOption | null {
  const normalizedQuery = normalizeQueryLanguageText(query)
  if (!normalizedQuery) return null
  const queryHaystack = ` ${normalizedQuery} `

  const candidates = languageOptions
    .filter((option) => option.publicSlug)
    .flatMap((option) =>
      queryLanguageAliases(option).map((alias) => ({
        alias,
        option,
      })),
    )
    .filter(({ alias }) => alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length)

  return (
    candidates.find(({ alias }) => queryHaystack.includes(` ${alias} `))
      ?.option ?? null
  )
}

function queryLanguageAliases(option: SearchLanguageOption): string[] {
  const aliases = new Set<string>()
  aliases.add(normalizeQueryLanguageText(option.englishName))
  aliases.add(
    normalizeQueryLanguageText(option.englishName.split(",")[0] ?? ""),
  )
  aliases.add(normalizeQueryLanguageText(option.publicSlug?.replace(/-/g, " ")))
  return [...aliases]
}

function normalizeQueryLanguageText(value: string | null | undefined): string {
  return ` ${value ?? ""} `
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function optionForPublicSlug(
  publicSlug: string,
  options: readonly SearchLanguageOption[] = [],
): SearchLanguageOption | null {
  return options.find((option) => option.publicSlug === publicSlug) ?? null
}

export function findSearchLanguageOptionByPublicSlug(
  publicSlug: string,
  options: readonly SearchLanguageOption[] = [],
): SearchLanguageOption | null {
  return optionForPublicSlug(publicSlug, options)
}

function resolutionFromSlug(
  slug: string | null | undefined,
  source: SearchLanguageResolutionSource,
  options: readonly SearchLanguageOption[],
): SearchLanguageResolution | null {
  if (!slug) return null

  const identity = resolveWatchLocaleIdentity(slug)
  const publicSlug = isPublicWatchLanguageSlug(slug)
    ? slug
    : publicSlugForLocale(identity.locale)
  const option = optionForPublicSlug(publicSlug, options)

  return {
    locale: identity.locale,
    publicSlug,
    englishName: option?.englishName ?? null,
    source,
  }
}

function resolutionFromEnglishName(
  englishName: string | null | undefined,
  options: readonly SearchLanguageOption[],
): SearchLanguageResolution | null {
  if (!englishName) return null
  const option = optionForEnglishName(englishName, options)
  if (!option?.publicSlug) return null
  return resolutionFromSlug(option.publicSlug, "explicit-selection", options)
}

function resolutionFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
  options: readonly SearchLanguageOption[],
): SearchLanguageResolution | null {
  const locale = parseAcceptLanguage(acceptLanguage ?? null)
  if (!locale) return null

  const publicSlug = publicSlugForLocale(locale)
  const option = optionForPublicSlug(publicSlug, options)
  return {
    locale,
    publicSlug,
    englishName: option?.englishName ?? null,
    source: "accept-language",
  }
}

export function resolveSearchLanguage({
  selectedEnglishNames = [],
  explicitSlug,
  routeLanguageSlug,
  acceptLanguage,
  languageOptions = [],
}: ResolveSearchLanguageInput): SearchLanguageResolution {
  const explicitSelection = selectedEnglishNames[0]
  const candidates: Array<SearchLanguageResolution | null> = [
    resolutionFromSlug(explicitSlug, "explicit-selection", languageOptions),
    resolutionFromEnglishName(explicitSelection, languageOptions),
    resolutionFromSlug(routeLanguageSlug, "route", languageOptions),
    resolutionFromAcceptLanguage(acceptLanguage, languageOptions),
  ]

  return (
    candidates.find((candidate) => candidate != null) ?? {
      locale: DEFAULT_LOCALE,
      publicSlug: ENGLISH_PUBLIC_SLUG,
      englishName:
        optionForPublicSlug(ENGLISH_PUBLIC_SLUG, languageOptions)
          ?.englishName ?? null,
      source: "fallback",
    }
  )
}

export function groupSearchLanguagesByRegion(
  options: readonly SearchLanguageOption[],
): SearchLanguageRegionGroup[] {
  const groups = new Map<string, SearchLanguageOption[]>()

  for (const option of options) {
    const regions =
      option.regionNames.length > 0 ? option.regionNames : [OTHER_REGION_NAME]
    for (const region of regions) {
      const current = groups.get(region) ?? []
      groups.set(region, [...current, option])
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionName, languages]) => ({
      regionName,
      languages: [...languages].sort((a, b) =>
        a.englishName.localeCompare(b.englishName),
      ),
    }))
}

export function buildSearchLanguageOptions({
  languages,
  countries = [],
  availableLanguageFacets,
  countryCode,
  countryName,
}: BuildSearchLanguageOptionsInput): BuildSearchLanguageOptionsResult {
  const facetNames = new Map<string, { label: string; count: number }>()
  for (const [label, count] of Object.entries(availableLanguageFacets ?? {})) {
    const normalized = normalizeSearchLanguageName(label)
    if (normalized.length === 0) continue
    facetNames.set(normalized, {
      label,
      count: Math.max(0, Math.floor(Number(count) || 0)),
    })
  }

  const regionNamesByLanguageKey = new Map<string, Set<string>>()
  const metadataByLanguageKey = new Map<
    string,
    SearchLanguageMetadataLanguage
  >()

  for (const language of languages) {
    const key = languageMetadataKey(language)
    if (key) metadataByLanguageKey.set(key, language)
  }

  for (const country of countries) {
    const regionName = localizedName(country.continent?.name)
    for (const countryLanguage of country.countryLanguages ?? []) {
      const language = countryLanguage.language
      if (!language) continue
      const key = languageMetadataKey(language)
      if (!key) continue
      metadataByLanguageKey.set(key, language)
      if (!regionName) continue
      const regions = regionNamesByLanguageKey.get(key) ?? new Set<string>()
      regions.add(regionName)
      regionNamesByLanguageKey.set(key, regions)
    }
  }

  const options: SearchLanguageOption[] = []
  const usedFacetNames = new Set<string>()

  for (const [key, language] of metadataByLanguageKey.entries()) {
    const option = languageOptionFromMetadata({
      language,
      regionNames: [...(regionNamesByLanguageKey.get(key) ?? [])],
      facetNames,
      usedFacetNames,
    })
    if (option) options.push(option)
  }

  for (const { label, count } of facetNames.values()) {
    const normalized = normalizeSearchLanguageName(label)
    if (usedFacetNames.has(normalized)) continue
    options.push({
      coreId: null,
      englishName: label,
      nativeName: null,
      bcp47: null,
      publicSlug: null,
      regionNames: [OTHER_REGION_NAME],
      facetCount: count,
    })
  }

  const sortedOptions = uniqueSearchLanguageOptions(options).sort((a, b) =>
    a.englishName.localeCompare(b.englishName),
  )

  return {
    options: sortedOptions,
    countrySuggestion: buildCountrySuggestion({
      countries,
      countryCode,
      countryName,
      options: sortedOptions,
    }),
  }
}

function languageOptionFromMetadata({
  language,
  regionNames,
  facetNames,
  usedFacetNames,
}: {
  language: SearchLanguageMetadataLanguage
  regionNames: string[]
  facetNames: Map<string, { label: string; count: number }>
  usedFacetNames: Set<string>
}): SearchLanguageOption | null {
  const englishName = localizedName(language.name)
  if (!englishName) return null

  const normalizedEnglishName = normalizeSearchLanguageName(englishName)
  const facet = facetNames.get(normalizedEnglishName)
  if (facetNames.size > 0 && !facet) return null

  if (facet) usedFacetNames.add(normalizedEnglishName)

  const publicSlug = publicSlugForLanguage(language)
  return {
    coreId: language.coreId ?? null,
    englishName: facet?.label ?? englishName,
    nativeName: nativeName(language.name, language.bcp47),
    bcp47: language.bcp47 ?? null,
    publicSlug,
    regionNames: regionNames.length > 0 ? regionNames : [OTHER_REGION_NAME],
    facetCount: facet?.count,
  }
}

function buildCountrySuggestion({
  countries,
  countryCode,
  countryName,
  options,
}: {
  countries: readonly SearchLanguageMetadataCountry[]
  countryCode?: string | null
  countryName?: string | null
  options: readonly SearchLanguageOption[]
}): SearchLanguageCountrySuggestion | null {
  const country = findCountry({ countries, countryCode, countryName })
  if (!country) return null

  const optionByKey = new Map<string, SearchLanguageOption>()
  for (const option of options) {
    for (const key of optionLookupKeys(option)) optionByKey.set(key, option)
  }

  const languages = [...(country.countryLanguages ?? [])]
    .sort(compareCountryLanguages)
    .flatMap((countryLanguage) => {
      const language = countryLanguage.language
      if (!language) return []
      const option = lookupLanguageOption(language, optionByKey)
      return option ? [option] : []
    })

  if (languages.length === 0) return null

  return {
    countryName: countryNameForDisplay(country),
    flagPngSrc: country.flagPngSrc ?? null,
    languages: uniqueSearchLanguageOptions(languages).slice(0, 6),
  }
}

function findCountry({
  countries,
  countryCode,
  countryName,
}: {
  countries: readonly SearchLanguageMetadataCountry[]
  countryCode?: string | null
  countryName?: string | null
}): SearchLanguageMetadataCountry | null {
  const normalizedCountryCode = countryCode?.trim().toUpperCase()
  const normalizedCountryName = countryName
    ? normalizeSearchLanguageName(countryName)
    : null

  return (
    countries.find((country) => {
      if (
        normalizedCountryCode &&
        country.coreId?.toUpperCase() === normalizedCountryCode
      ) {
        return true
      }
      if (!normalizedCountryName) return false
      return (
        normalizeSearchLanguageName(countryNameForDisplay(country)) ===
        normalizedCountryName
      )
    }) ?? null
  )
}

function compareCountryLanguages(
  a: SearchLanguageMetadataCountryLanguage,
  b: SearchLanguageMetadataCountryLanguage,
): number {
  return (
    (b.speakers ?? 0) - (a.speakers ?? 0) ||
    Number(b.suggested === true) - Number(a.suggested === true) ||
    Number(b.primary === true) - Number(a.primary === true) ||
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
}

function lookupLanguageOption(
  language: SearchLanguageMetadataLanguage,
  optionByKey: Map<string, SearchLanguageOption>,
): SearchLanguageOption | null {
  const keys = [
    language.coreId ? `core:${language.coreId}` : null,
    language.slug ? `slug:${language.slug}` : null,
    localizedName(language.name)
      ? `name:${normalizeSearchLanguageName(localizedName(language.name)!)}`
      : null,
  ].filter((key): key is string => key != null)

  for (const key of keys) {
    const option = optionByKey.get(key)
    if (option) return option
  }
  return null
}

function optionLookupKeys(option: SearchLanguageOption): string[] {
  return [
    option.coreId ? `core:${option.coreId}` : null,
    option.publicSlug ? `slug:${option.publicSlug}` : null,
    `name:${normalizeSearchLanguageName(option.englishName)}`,
  ].filter((key): key is string => key != null)
}

function uniqueSearchLanguageOptions(
  options: readonly SearchLanguageOption[],
): SearchLanguageOption[] {
  const byName = new Map<string, SearchLanguageOption>()
  for (const option of options) {
    const key = normalizeSearchLanguageName(option.englishName)
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, option)
      continue
    }
    byName.set(key, {
      ...existing,
      coreId: existing.coreId ?? option.coreId,
      nativeName: existing.nativeName ?? option.nativeName,
      bcp47: existing.bcp47 ?? option.bcp47,
      publicSlug: existing.publicSlug ?? option.publicSlug,
      regionNames: [
        ...new Set([...existing.regionNames, ...option.regionNames]),
      ],
      facetCount: existing.facetCount ?? option.facetCount,
    })
  }
  return [...byName.values()]
}

function languageMetadataKey(
  language: SearchLanguageMetadataLanguage,
): string | null {
  if (language.coreId) return `core:${language.coreId}`
  if (language.id) return `id:${language.id}`
  const name = localizedName(language.name)
  return name ? `name:${normalizeSearchLanguageName(name)}` : null
}

function publicSlugForLanguage(
  language: SearchLanguageMetadataLanguage,
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

function countryNameForDisplay(country: SearchLanguageMetadataCountry): string {
  return localizedName(country.name) ?? country.coreId ?? "Your region"
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
