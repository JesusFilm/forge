type LanguageOption = {
  slug: string
  bcp47: string | null
  /**
   * Unique, stable language-entity slug (e.g. "korean", "english-north-american-
   * indigenous"). Used for EXACT preference matching — unlike bcp47, it never
   * collides across distinct languages. Required (nullable) so a caller that
   * passes a `preferredLanguageSlug` can't silently forget to populate it and
   * get a never-matching preference.
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
 * Resolve the best default language from a list of options.
 *
 * Priority: explicit user preference → device locale → video primary language →
 * English → first option.
 *
 * `preferredLanguageSlug` is the app-wide language the user last chose (persisted
 * in {@link WatchPreferencesProvider}). It is matched EXACTLY against each
 * option's `languageSlug`, never by bcp47 prefix — bcp47 prefixes collide across
 * distinct languages (Korean "ko" vs Kurmanji "ko-kmr"; English "en" vs the
 * indigenous "en-nai"), so a prefix match would re-select the wrong sibling. It
 * outranks the device locale so a deliberate pick carries across every video, and
 * is a soft preference: when no option matches it, resolution falls through to
 * the locale/primary/English chain so a video that lacks it still defaults sanely.
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
