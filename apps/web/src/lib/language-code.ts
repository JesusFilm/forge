/**
 * Return the primary BCP 47 language subtag in the compact uppercase form
 * used by Watch's selector and switcher chrome (for example `en-US` → `EN`).
 */
export function primaryLanguageCode(
  value: string | null | undefined,
): string | null {
  const primary = value?.trim().split(/[-_]/)[0]?.trim() ?? ""
  return /^[A-Za-z]{2,3}$/.test(primary) ? primary.toUpperCase() : null
}

type LanguageCodeSource = {
  bcp47?: string | null
  iso3?: string | null
  slug?: string | null
}

/**
 * Prefer BCP 47 because it is the canonical public language identifier. When
 * a legacy row lacks it, the Watch slug map provides the same two-letter
 * primary subtag before falling back to ISO 639-3 metadata.
 */
export function languageCodeFor({
  bcp47,
  iso3,
  slug,
}: LanguageCodeSource): string | null {
  const bcp47Code = primaryLanguageCode(bcp47)
  if (bcp47Code) return bcp47Code

  const slugCode = slug ? primaryLanguageCode(slugToBcp47Primary(slug)) : null
  if (slugCode) return slugCode

  const iso3Code = primaryLanguageCode(iso3)
  if (iso3Code) return iso3Code

  const fallback = slug?.trim().match(/^[A-Za-z]{2,3}$/)?.[0]
  return fallback ? fallback.toUpperCase() : null
}
import { slugToBcp47Primary } from "@/lib/locale"
