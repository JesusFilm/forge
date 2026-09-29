// No store import: localeStore.ts reads this, and adminLanguage.ts reads the
// store, so the lookup lives here to keep Metro free of a require cycle.
import {
  AUDIO_SLUG_BY_TAG,
  REVIEWED_AUDIO_SLUG_BY_TAG,
} from "./adminLanguages.generated"

function own(table: Readonly<Record<string, string>>, key: string) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null
}

/** The exact tag, then `language-region` when a script sits between, then the language. */
function lookupKeys(exact: string): string[] {
  const parts = exact.split("-")
  const language = parts[0]
  // A region is 2 letters or 3 digits; a 4-letter part is a script.
  const region = parts
    .slice(1)
    .find((part) => /^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part))
  const keys = [exact]
  if (region != null) keys.push(`${language}-${region}`)
  keys.push(language)
  return [...new Set(keys)]
}

/**
 * The default-audio slug for a phone language tag such as `es-ES` or
 * `zh-Hant-TW`, else null. A reviewed entry wins over Admin's own tags: the
 * reviewed keys first, then Admin's, each from the exact tag to the language.
 */
export function audioSlugForLocaleTag(
  tag: string | null | undefined,
): string | null {
  const exact = (tag ?? "").trim().toLowerCase().replace(/_/g, "-")
  if (exact === "") return null
  const keys = lookupKeys(exact)
  for (const table of [REVIEWED_AUDIO_SLUG_BY_TAG, AUDIO_SLUG_BY_TAG]) {
    for (const key of keys) {
      const slug = own(table, key)
      if (slug != null) return slug
    }
  }
  return null
}
