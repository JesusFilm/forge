// KTD10: Admin video text in the UI language, one field at a time, with the
// English row as the fallback. Every reader takes the Admin language forms as
// an argument, so a screen that captured its forms (KTD16) never reads the store.
import type { AdminLanguageForms } from "../i18n/adminLanguage"

/** Admin's language slug for the English text rows. */
export const ENGLISH_TEXT_SLUG = "english"

/** The `lang` of text that falls back to English (R10). */
export const ENGLISH_TEXT_LANG = "en"

/** One Admin text value and the language it is in (KTD10, KTD13). */
export type LocalizedText = {
  readonly text: string
  readonly lang: string
}

/** One `VideoLocale` row as the text documents select it. */
export type VideoTextRow = {
  readonly languageSlug?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly snippet?: string | null
  readonly imageAlt?: string | null
}

type Rows = readonly VideoTextRow[] | null | undefined

/** A video's two row lists: the UI-language rows and the aliased English rows. */
export type VideoTextSource = {
  readonly locales?: Rows
  readonly englishLocales?: Rows
}

/** The variables for every `locales(languageSlug: $textSlug)` selection. The
 *  slug is never null or blank, because Admin returns every language's row for
 *  a null slug. One helper, so Home and the watch screen share a cache entry. */
export function videoTextVariables(forms: AdminLanguageForms): {
  textSlug: string
} {
  const slug = forms.textSlug.trim()
  return { textSlug: slug === "" ? ENGLISH_TEXT_SLUG : slug }
}

/** Variables for `watchSetting` and `experienceBySlug`, which take the catalog
 *  tag (KTD9). `isEnglish` skips the aliased `en` duplicate under `en`. */
export function localeQueryVariables(catalogTag: string): {
  locale: string
  isEnglish: boolean
} {
  return { locale: catalogTag, isEnglish: catalogTag === "en" }
}

/** The language of the text in the forms' own rows. */
export function textLangFor(forms: AdminLanguageForms): string {
  return videoTextVariables(forms).textSlug === ENGLISH_TEXT_SLUG
    ? ENGLISH_TEXT_LANG
    : forms.catalogTag
}

/** True when the forms read rows in a language other than English. */
export function readsLocalizedRows(forms: AdminLanguageForms): boolean {
  return videoTextVariables(forms).textSlug !== ENGLISH_TEXT_SLUG
}

function nonBlank(value: string | null | undefined): string | null {
  return value != null && value.trim() !== "" ? value : null
}

// The row for one slug, never a row of another language. A row with no slug
// is the older snapshot and fixture shape; Admin's filter sends only the slug.
function rowFor(rows: Rows, slug: string): VideoTextRow | null {
  if (!rows) return null
  return (
    rows.find((row) => row.languageSlug === slug) ??
    rows.find((row) => row.languageSlug == null) ??
    null
  )
}

function exactRowFor(rows: Rows, slug: string): VideoTextRow | null {
  return rows?.find((row) => row.languageSlug === slug) ?? null
}

/** The UI-language row for the forms, or null. */
export function uiTextRow(
  source: VideoTextSource | null | undefined,
  forms: AdminLanguageForms,
): VideoTextRow | null {
  return rowFor(source?.locales, videoTextVariables(forms).textSlug)
}

/** The English row: the aliased English rows, else an English UI row. */
export function englishTextRow(
  source: VideoTextSource | null | undefined,
): VideoTextRow | null {
  return (
    rowFor(source?.englishLocales, ENGLISH_TEXT_SLUG) ??
    exactRowFor(source?.locales, ENGLISH_TEXT_SLUG)
  )
}

/** One field in the UI language, else in English, else null (R10). Each field
 *  falls back on its own: a Russian title can sit beside an English one. */
export function pickVideoText(
  source: VideoTextSource | null | undefined,
  forms: AdminLanguageForms,
  read: (row: VideoTextRow) => string | null | undefined,
): LocalizedText | null {
  const ui = uiTextRow(source, forms)
  const uiValue = ui ? nonBlank(read(ui)) : null
  if (uiValue != null) return { text: uiValue, lang: textLangFor(forms) }
  const english = englishTextRow(source)
  const englishValue = english ? nonBlank(read(english)) : null
  return englishValue != null
    ? { text: englishValue, lang: ENGLISH_TEXT_LANG }
    : null
}

/** The UI-language value only, with no English fallback. */
export function pickUiVideoText(
  source: VideoTextSource | null | undefined,
  forms: AdminLanguageForms,
  read: (row: VideoTextRow) => string | null | undefined,
): LocalizedText | null {
  if (!readsLocalizedRows(forms)) return null
  const ui = uiTextRow(source, forms)
  const value = ui ? nonBlank(read(ui)) : null
  return value != null ? { text: value, lang: textLangFor(forms) } : null
}

export const readTitle = (row: VideoTextRow) => row.title
export const readDescription = (row: VideoTextRow) => row.description
export const readSnippet = (row: VideoTextRow) => row.snippet
export const readImageAlt = (row: VideoTextRow) => row.imageAlt
/** A card's short text: the snippet, else the description, of one row. */
export const readCardDescription = (row: VideoTextRow) =>
  nonBlank(row.snippet) ?? row.description
