// SYNC: keep in sync with apps/mobile/src/lib/resolveDefaultLanguage.ts
//
// Resolves the default audio dub. TV v1 has no persisted preference yet, but
// `preferredLanguageSlug` stays wired for when persistence lands and to keep the
// priority chain matching mobile's.

type LanguageOption = {
  slug: string
  bcp47: string | null
  /**
   * Unique, stable language-entity slug (e.g. "korean"). Used for EXACT
   * preference matching — unlike bcp47 it never collides across languages.
   * Required (nullable) so callers can't forget it and get a non-matching pref.
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
 * Resolve the best default language. Priority: preference → device locale →
 * video primary → English → first option. `preferredLanguageSlug` matches EXACTLY
 * on `languageSlug`, never bcp47 prefix (prefixes collide: ko vs ko-kmr, en vs
 * en-nai). Soft: no match falls through the chain so videos lacking it still default.
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
