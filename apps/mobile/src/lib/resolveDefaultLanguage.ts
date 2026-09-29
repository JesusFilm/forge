import { defaultAudioLanguage } from "../i18n/localeStore"

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

// Exact tags first, from the whole tag down to the language: "en" and "en-nai"
// share a prefix, so a pure prefix scan lets ARRAY ORDER pick the winner — which
// handed JESUS "English, North American Indigenous" (index 266) over plain
// English (index 614) across its 2281 dubs.
function matchByBcp47(
  options: LanguageOption[],
  targetBcp47: string,
): LanguageOption | undefined {
  const parts = targetBcp47.toLowerCase().replace(/_/g, "-").split("-")
  const base = parts[0]
  const tag = (o: LanguageOption) => o.bcp47?.toLowerCase() ?? null
  for (let length = parts.length; length > 0; length -= 1) {
    const exact = parts.slice(0, length).join("-")
    const match = options.find((o) => tag(o) === exact)
    if (match) return match
  }
  return options.find((o) => tag(o)?.split("-")[0] === base)
}

/**
 * Resolve the best default language: preference (persisted in {@link WatchPreferencesProvider})
 * → the phone's first language ({@link defaultAudioLanguage}) → video primary →
 * English → first option. `preferredLanguageSlug` matches EXACTLY on
 * `languageSlug`, never bcp47 prefix (ko/ko-kmr, en/en-nai collide); soft.
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

  // An empty phone list (a dev client built before expo-localization) skips
  // this step, so the primary language, then English, decides.
  const phone = defaultAudioLanguage()
  if (phone) {
    const match =
      (phone.slug == null
        ? undefined
        : options.find((o) => o.languageSlug === phone.slug)) ??
      matchByBcp47(options, phone.tag)
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
