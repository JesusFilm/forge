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

// Exact tag first: "en" and "en-nai" share a prefix, so a pure prefix scan lets
// ARRAY ORDER pick the winner — which handed JESUS "English, North American
// Indigenous" (index 266) over plain English (index 614) across its 2281 dubs.
function matchByBcp47(
  options: LanguageOption[],
  targetBcp47: string,
): LanguageOption | undefined {
  const full = targetBcp47.toLowerCase()
  const base = full.split("-")[0]
  const tag = (o: LanguageOption) => o.bcp47?.toLowerCase() ?? null
  return (
    options.find((o) => tag(o) === full) ??
    options.find((o) => tag(o) === base) ??
    options.find((o) => tag(o)?.split("-")[0] === base)
  )
}

/**
 * Resolve the best default language: preference (persisted in {@link WatchPreferencesProvider})
 * → device locale → video primary → English → first option. `preferredLanguageSlug` matches
 * EXACTLY on `languageSlug`, never bcp47 prefix (ko/ko-kmr, en/en-nai collide); soft.
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
    const match = matchByBcp47(options, deviceLang)
    if (match) return match.slug
  }

  if (videoPrimaryBcp47) {
    const match = matchByBcp47(options, videoPrimaryBcp47)
    if (match) return match.slug
  }

  const english = matchByBcp47(options, "en")
  if (english) return english.slug

  return options[0].slug
}
