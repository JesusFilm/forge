// The translation picker's list (feat-553 U10, R23, R30, R41): the viewer's
// languages first, then every other catalog language by its English name.
// Pure; the picker passes the download states in.
import type { Catalog, CatalogTranslation } from "../data/catalog"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../data/languageDefaults.generated"
import { catalogLanguageCode } from "../language/phoneLanguage"
import type { TranslationDownloadState } from "../repository/translationDownloads"
import { READER_SHEET_COPY } from "./copy"

type LanguageDefaults = Readonly<Record<string, string>>

/** The catalog languages for the audio and phone codes, in that order. */
export function viewerLanguageCodes(
  codes: readonly (string | null | undefined)[],
  languageDefaults: LanguageDefaults = LANGUAGE_DEFAULT_TRANSLATIONS,
): string[] {
  const languages: string[] = []
  for (const code of codes) {
    const language = catalogLanguageCode(code, languageDefaults)
    if (language !== null && !languages.includes(language)) {
      languages.push(language)
    }
  }
  return languages
}

/** BSB ships inside the app; a download holds a translation too (R30). */
export function isOnDevice(state: TranslationDownloadState): boolean {
  return state.kind === "bundled" || state.kind === "downloaded"
}

/** U4 keeps the old copy after a failed update, with the old catalog hash. */
export function isUpdateAvailable(
  translation: CatalogTranslation,
  state: TranslationDownloadState,
): boolean {
  return state.kind === "downloaded" && state.sha256 !== translation.sha256
}

export type TranslationListInput = {
  catalog: Catalog
  /** From `viewerLanguageCodes`: the audio language, then the phone's. */
  viewerLanguages: readonly string[]
  /** R41's offline filter: only BSB and downloaded translations. */
  onDeviceOnly: boolean
  getState: (translationId: string) => TranslationDownloadState
  languageDefaults?: LanguageDefaults
}

function byText(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

export function buildTranslationList(
  input: TranslationListInput,
): CatalogTranslation[] {
  const defaults = input.languageDefaults ?? LANGUAGE_DEFAULT_TRANSLATIONS
  const viewerRank = new Map(
    input.viewerLanguages.map((language, index) => [language, index]),
  )
  const rows = input.onDeviceOnly
    ? input.catalog.translations.filter((translation) =>
        isOnDevice(input.getState(translation.id)),
      )
    : [...input.catalog.translations]

  // Inside one language: its default first, then complete Bibles, then names.
  const withinLanguage = (a: CatalogTranslation, b: CatalogTranslation) => {
    const aDefault = defaults[a.language] === a.id ? 0 : 1
    const bDefault = defaults[b.language] === b.id ? 0 : 1
    if (aDefault !== bDefault) return aDefault - bDefault
    if (a.complete !== b.complete) return a.complete ? -1 : 1
    return byText(a.name, b.name)
  }

  return rows.sort((a, b) => {
    const aRank = viewerRank.get(a.language) ?? Number.POSITIVE_INFINITY
    const bRank = viewerRank.get(b.language) ?? Number.POSITIVE_INFINITY
    if (aRank !== bRank) return aRank < bRank ? -1 : 1
    if (a.language !== b.language) {
      const byName = byText(a.languageEnglishName, b.languageEnglishName)
      return byName !== 0 ? byName : byText(a.language, b.language)
    }
    return withinLanguage(a, b)
  })
}

/** Search matches the language or the translation, in either name. */
export function translationSearchValues(
  translation: CatalogTranslation,
): string[] {
  return [
    translation.name,
    translation.englishName,
    translation.shortName,
    translation.languageName,
    translation.languageEnglishName,
  ]
}

/** "русский · Russian"; one name when the two are the same. */
export function translationLanguageLabel(
  translation: CatalogTranslation,
): string {
  const { languageName, languageEnglishName } = translation
  return languageName.toLowerCase() === languageEnglishName.toLowerCase()
    ? languageName
    : `${languageName} · ${languageEnglishName}`
}

function downloadStatus(
  translation: CatalogTranslation,
  state: TranslationDownloadState,
): string[] {
  const copy = READER_SHEET_COPY.translation
  switch (state.kind) {
    case "bundled":
      return [copy.onDevice]
    case "downloaded":
      return isUpdateAvailable(translation, state)
        ? [copy.onDevice, copy.updateAvailable]
        : [copy.onDevice]
    case "downloading":
      return [copy.downloading(Math.round(state.percent))]
    case "failed":
      return [copy.downloadStopped]
    case "checking":
    case "not-downloaded":
      return []
  }
}

/** R23: complete or partial, then the download state. A screen reader reads it. */
export function translationStatusLabel(
  translation: CatalogTranslation,
  state: TranslationDownloadState,
): string {
  const copy = READER_SHEET_COPY.translation
  return [
    translation.complete ? copy.complete : copy.partial,
    ...downloadStatus(translation, state),
  ].join(", ")
}
