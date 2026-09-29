// The translation picker's list (feat-553 U10, R23, R30, R41): the viewer's
// languages first, then every other catalog language by its English name.
// Pure; the picker passes the download states in.
import { compareIds, nameComparator } from "../../collation"
import type { Catalog, CatalogTranslation } from "../data/catalog"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../data/languageDefaults.generated"
import { catalogLanguageCode } from "../language/phoneLanguage"
import type { TranslationDownloadState } from "../repository/translationDownloads"
import { BIBLE_BOOKS, type UsfmBookId } from "../text/books"
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
  /** The UI language tag the names collate in (KTD15). */
  uiTag: string
}

export function buildTranslationList(
  input: TranslationListInput,
): CatalogTranslation[] {
  const defaults = input.languageDefaults ?? LANGUAGE_DEFAULT_TRANSLATIONS
  const byText = nameComparator(input.uiTag)
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
      return byName !== 0 ? byName : compareIds(a.language, b.language)
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

/** A few names as one phrase: "Ruth", "Ruth and Luke", "Ruth, Luke, and John". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

/** Named in full up to this many books; more are a count. */
const NAMED_BOOKS_MAX = 3

// Which books a partial Bible has (owner, 2026-09-28): "Partial Bible" did not
// say that a New Testament has no Genesis. Most partial Bibles are a New
// Testament (705 of 1,053 on 2026-09-28), so a whole testament reads as a unit.
export function coverageLabel(books: ReadonlySet<UsfmBookId>): string {
  const copy = READER_SHEET_COPY.translation.coverage
  const testaments = [
    { name: READER_SHEET_COPY.passage.newTestament, key: "new" },
    { name: READER_SHEET_COPY.passage.oldTestament, key: "old" },
  ] as const
  for (const { name, key } of testaments) {
    const whole = BIBLE_BOOKS.filter((book) => book.testament === key)
    if (!whole.every((book) => books.has(book.usfm))) continue
    const extra = BIBLE_BOOKS.filter(
      (book) => book.testament !== key && books.has(book.usfm),
    ).map((book) => book.name)
    if (extra.length === 0) {
      return key === "new" ? copy.newTestament : copy.oldTestament
    }
    return extra.length < NAMED_BOOKS_MAX
      ? joinNames([name, ...extra])
      : copy.testamentAndOthers(name, extra.length)
  }
  const names = BIBLE_BOOKS.filter((book) => books.has(book.usfm)).map(
    (book) => book.name,
  )
  return names.length <= NAMED_BOOKS_MAX
    ? copy.only(joinNames(names))
    : copy.someBooks(names.length, BIBLE_BOOKS.length)
}

/** R23: the books it has, then the download state. A screen reader reads it. */
export function translationStatusLabel(
  translation: CatalogTranslation,
  state: TranslationDownloadState,
): string {
  const copy = READER_SHEET_COPY.translation
  return [
    translation.complete ? copy.complete : coverageLabel(translation.books),
    ...downloadStatus(translation, state),
  ].join(", ")
}
