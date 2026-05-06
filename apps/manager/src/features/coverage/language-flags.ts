export type LanguageFlagSource = {
  bcp47?: string | null
  iso3?: string | null
  countryIds: string[]
  countrySpeakers: Record<string, number>
}

export function countryIdToCircleFlagUrl(countryId: string): string {
  const normalized = countryId.trim().toLowerCase()
  if (!/^[a-z]{2}$/.test(normalized)) return ""

  return `https://hatscripts.github.io/circle-flags/flags/${normalized}.svg`
}

function resolveCountryFromLanguageCode(code: string | null | undefined) {
  const normalized = code?.trim().replace(/_/g, "-")
  if (!normalized) return ""

  try {
    return new Intl.Locale(normalized).maximize().region?.toUpperCase() ?? ""
  } catch {
    return ""
  }
}

function resolveDominantCountry(language: LanguageFlagSource) {
  if (language.countryIds.length === 1) {
    return language.countryIds[0]?.toUpperCase() ?? ""
  }

  const rankedCountries = Object.entries(language.countrySpeakers)
    .filter(([, speakers]) => Number.isFinite(speakers) && speakers > 0)
    .sort(([, a], [, b]) => b - a)

  const [topCountry, topSpeakers] = rankedCountries[0] ?? []
  const [, nextSpeakers] = rankedCountries[1] ?? []

  if (!topCountry || topSpeakers == null) return ""
  if (nextSpeakers != null && topSpeakers <= nextSpeakers) return ""

  return topCountry.toUpperCase()
}

export function resolveLanguageFlagCountryId(
  language: LanguageFlagSource,
): string {
  const codeCountry =
    resolveCountryFromLanguageCode(language.bcp47) ||
    resolveCountryFromLanguageCode(language.iso3)

  if (codeCountry && countryIdToCircleFlagUrl(codeCountry)) {
    return codeCountry
  }

  const dominantCountry = resolveDominantCountry(language)
  if (dominantCountry && countryIdToCircleFlagUrl(dominantCountry)) {
    return dominantCountry
  }

  return ""
}
