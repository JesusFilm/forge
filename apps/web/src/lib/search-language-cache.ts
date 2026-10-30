export function searchLanguageOptionsCacheKey(
  availableLanguageFacets?: Record<string, number>,
  uiLocale = "en",
): string {
  if (
    availableLanguageFacets == null ||
    Object.keys(availableLanguageFacets).length === 0
  ) {
    return `${uiLocale}:__default__`
  }

  return `${uiLocale}:${Object.entries(availableLanguageFacets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, count]) => `${language}:${count}`)
    .join("|")}`
}
