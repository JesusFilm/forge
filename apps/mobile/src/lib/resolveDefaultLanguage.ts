type LanguageOption = {
  slug: string
  bcp47: string | null
  /**
   * Unique, stable language-entity slug (e.g. "korean"). Used for EXACT
   * preference matching — unlike bcp47, it never collides across languages.
   * Required (nullable) so a caller can't silently forget to populate it.
   */
  languageSlug: string | null
}

function getDeviceLanguageCode(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    return locale.split("-")[0].toLowerCase()
  } catch {
    return null
  }
}

function matchByBcp47Prefix(
  options: LanguageOption[],
  targetBcp47: string,
): LanguageOption | undefined {
  const target = targetBcp47.split("-")[0].toLowerCase()
  return options.find(
    (o) => o.bcp47 != null && o.bcp47.split("-")[0].toLowerCase() === target,
  )
}

/**
 * Resolve the best default language. Priority: user preference → device locale →
 * video primary language → English → first option. `preferredLanguageSlug` (last
 * chosen, persisted in {@link WatchPreferencesProvider}) matches EXACTLY on
 * `languageSlug`, never bcp47 prefix — prefixes collide across languages (ko vs
 * ko-kmr, en vs en-nai). It outranks the locale but is soft: no match falls
 * through the chain so a video lacking it still defaults sanely.
 */
export function resolveDefaultSlug(
  options: LanguageOption[],
  videoPrimaryBcp47: string | null,
  preferredLanguageSlug?: string | null,
): string | null {
  if (options.length === 0) return null

  if (preferredLanguageSlug) {
    const match = options.find((o) => o.languageSlug === preferredLanguageSlug)
    if (match) return match.slug
  }

  const deviceLang = getDeviceLanguageCode()
  if (deviceLang) {
    const match = matchByBcp47Prefix(options, deviceLang)
    if (match) return match.slug
  }

  if (videoPrimaryBcp47) {
    const match = matchByBcp47Prefix(options, videoPrimaryBcp47)
    if (match) return match.slug
  }

  const english = matchByBcp47Prefix(options, "en")
  if (english) return english.slug

  return options[0].slug
}
