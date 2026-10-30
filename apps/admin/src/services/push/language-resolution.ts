/**
 * KTD5 — language resolution runs on the server and matches exactly.
 *
 * Campaign copy is keyed by the Language slug, which is unique. The BCP-47
 * tag is not: two Languages can carry `ko`, and `ko-kmr` shares only the
 * subtag. So a phone's tag is matched exactly first, then by its language
 * subtag alone, and never by a prefix scan.
 */

/** English is the copy every campaign must carry (R6). */
export const PUSH_ENGLISH_LANGUAGE_SLUG = "english"

/** The two Language columns this module reads. A row with no slug is dropped. */
export type PushLanguageRow = Readonly<{
  slug: string | null
  bcp47: string | null
}>

export type PushCopyRung =
  | "app_language"
  | "phone_tag"
  | "phone_subtag"
  | "fallback"

export type PushCopyResolution = Readonly<{
  languageSlug: string
  rung: PushCopyRung
}>

export type PushCopyPhone = Readonly<{
  appLanguageSlug: string | null
  phoneLocale: string | null
}>

/** A phone's copy, resolved for one campaign. `null` means no copy applies. */
export type PushCopyResolver = (
  phone: PushCopyPhone,
) => PushCopyResolution | null

function normalizeTag(tag: string | null | undefined): string | null {
  const trimmed = tag?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

function languageSubtag(tag: string): string {
  return tag.split("-")[0]
}

/** Language slugs per lowercased tag, each list sorted so a tie is stable. */
function indexByTag(
  languages: readonly PushLanguageRow[],
): Map<string, string[]> {
  const byTag = new Map<string, string[]>()
  for (const language of languages) {
    const tag = normalizeTag(language.bcp47)
    const slug = language.slug?.trim()
    if (!tag || !slug) continue
    const slugs = byTag.get(tag)
    if (slugs) slugs.push(slug)
    else byTag.set(tag, [slug])
  }
  for (const slugs of byTag.values()) slugs.sort()
  return byTag
}

/**
 * Builds one resolver for a campaign and calls it per phone.
 *
 * The copy set disambiguates a shared tag: when two Languages carry `ko`,
 * the one the campaign wrote copy for wins.
 */
export function createPushCopyResolver(input: {
  copySlugs: readonly string[]
  languages: readonly PushLanguageRow[]
  fallbackSlug?: string
}): PushCopyResolver {
  const copy = new Set(input.copySlugs)
  const byTag = indexByTag(input.languages)
  const fallbackSlug = input.fallbackSlug ?? PUSH_ENGLISH_LANGUAGE_SLUG
  const fallback: PushCopyResolution | null = copy.has(fallbackSlug)
    ? { languageSlug: fallbackSlug, rung: "fallback" }
    : null

  const authored = (tag: string | null): string | undefined => {
    if (!tag) return undefined
    return byTag.get(tag)?.find((slug) => copy.has(slug))
  }

  return (phone) => {
    const appSlug = phone.appLanguageSlug?.trim()
    if (appSlug && copy.has(appSlug)) {
      return { languageSlug: appSlug, rung: "app_language" }
    }
    const tag = normalizeTag(phone.phoneLocale)
    const exact = authored(tag)
    if (exact) return { languageSlug: exact, rung: "phone_tag" }
    const subtag = tag ? languageSubtag(tag) : null
    const reduced = subtag === tag ? undefined : authored(subtag)
    if (reduced) return { languageSlug: reduced, rung: "phone_subtag" }
    return fallback
  }
}

/** One phone's copy language. Prefer the resolver when sending a page. */
export function resolvePushCopyLanguage(input: {
  copySlugs: readonly string[]
  languages: readonly PushLanguageRow[]
  appLanguageSlug: string | null
  phoneLocale: string | null
  fallbackSlug?: string
}): PushCopyResolution | null {
  return createPushCopyResolver(input)({
    appLanguageSlug: input.appLanguageSlug,
    phoneLocale: input.phoneLocale,
  })
}

/**
 * The registration's stored phone language slug, derived at registration time
 * through the same rungs.
 *
 * No campaign copy exists yet, so a tag several Languages share cannot be
 * disambiguated by authored copy. The lowest slug in ascending order wins,
 * which keeps the derivation independent of row order.
 */
export function derivePhoneLanguageSlug(
  phoneLocale: string | null,
  languages: readonly PushLanguageRow[],
): string | null {
  const tag = normalizeTag(phoneLocale)
  if (!tag) return null
  const byTag = indexByTag(languages)
  const exact = byTag.get(tag)?.[0]
  if (exact) return exact
  const subtag = languageSubtag(tag)
  if (subtag === tag) return null
  return byTag.get(subtag)?.[0] ?? null
}
