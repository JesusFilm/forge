import type { AdminLanguageForms } from "../i18n/adminLanguage"
import { ENGLISH_TEXT_LANG, textLangFor, type LocalizedText } from "./videoText"

// Admin stores localized name columns as jsonb locale maps: { "en": "...", "es": "..." }.
// gql.tada types JSON fields as `unknown`, so TypeScript won't catch misuse.
// The keys are Admin's own tags in Admin's case (`zh-hans`, `es-ES`, `npi`).
const LOCALE_FALLBACK_ORDER = [
  "en",
  "es",
  "fr",
  "pt",
  "de",
  "id",
  "ja",
  "ko",
  "ru",
  "th",
  "tr",
  "zh",
] as const

/** A name and the map key it came from; `key` is null for a plain string. */
export type LocalizedNameEntry = {
  readonly text: string
  readonly key: string | null
}

function own(map: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null
  const value = map[key]
  return typeof value === "string" && value !== "" ? value : null
}

/** The name for Admin's raw tag (exact), then `en`, then the common tags, then
 *  the first value. The key it used lets a caller mark an English fallback
 *  with its language (R10). */
export function pickLocalizedNameEntry(
  value: unknown,
  rawTag?: string | null,
): LocalizedNameEntry | undefined {
  if (value == null) return undefined
  if (typeof value === "string") return { text: value, key: null }
  if (typeof value !== "object" || Array.isArray(value)) return undefined

  const map = value as Record<string, unknown>
  const order = rawTag
    ? [rawTag, ...LOCALE_FALLBACK_ORDER]
    : LOCALE_FALLBACK_ORDER
  for (const key of order) {
    const text = own(map, key)
    if (text != null) return { text, key }
  }
  for (const [key, text] of Object.entries(map)) {
    if (typeof text === "string" && text !== "") return { text, key }
  }
  return undefined
}

/** The text of {@link pickLocalizedNameEntry}. */
export function pickLocalizedName(
  value: unknown,
  rawTag?: string | null,
): string | undefined {
  return pickLocalizedNameEntry(value, rawTag)?.text
}

// The key of a name map tells its language: Admin's raw tag is the UI
// language, `en` is the English fallback, and any other key is itself.
function nameLang(key: string | null, forms: AdminLanguageForms): string {
  if (key == null) return ENGLISH_TEXT_LANG
  if (key === forms.rawTag) return textLangFor(forms)
  return key
}

/** An Admin name map in the UI language, else English (R9, R10), with the
 *  language the chosen name is in. */
export function pickAdminName(
  value: unknown,
  forms: AdminLanguageForms,
): LocalizedText | null {
  if (value == null) return null
  const entry = pickLocalizedNameEntry(value, forms.rawTag)
  if (!entry) return null
  return { text: entry.text, lang: nameLang(entry.key, forms) }
}
