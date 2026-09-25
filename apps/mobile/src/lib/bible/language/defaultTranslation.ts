// Which translation the reader shows (feat-551 R22, R25, R41, KD13, KD22).
// Pure apart from the injected device check, so it runs without React.
//
// The order is: the R31 session switch, the saved pick, the audio language's
// default, the phone language's default, then BSB. Nothing here saves; the
// position store saves only a pick that the viewer made (R41).
import type { Catalog, CatalogTranslation } from "../data/catalog"
import { LANGUAGE_DEFAULT_TRANSLATIONS } from "../data/languageDefaults.generated"
import type { ChapterFailureReason } from "../repository/errors"
import {
  pickTranslationForBook,
  toTranslationRef,
  type ChapterRequest,
} from "../repository/resolveChapter"
import type { UsfmBookId } from "../text/books"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import type { VerseRef } from "../versification/convert"
import { catalogLanguageCode } from "./phoneLanguage"

/** Why the rules chose the viewer's translation. */
export type ViewerTranslationSource =
  | "session"
  | "explicit"
  | "audio"
  | "phone"
  | "bsb-default"

export type ViewerTranslation = {
  translationId: string
  source: ViewerTranslationSource
}

export type ViewerTranslationInput = {
  catalog: Catalog
  /** The R31 switch: the position store's `sessionTranslationId`. */
  sessionTranslationId: string | null
  /** The saved pick: the position store's `translationId`. */
  explicitTranslationId: string | null
  /** `WatchPreferences.audioLanguageIso3`, as admin sends it. */
  audioLanguage: string | null
  /** `readPhoneLanguageCode()`. */
  phoneLanguage: string | null
  /** Tests only; the generated table is the default. */
  languageDefaults?: Readonly<Record<string, string>>
}

/**
 * Why the shown translation shows. Only `viewer` needs no label: the others
 * name the translation shown (R25) or mark BSB as a stand-in (R41).
 */
export type ShownTranslationReason =
  | "viewer"
  | "book-fallback"
  | "offline-stand-in"

/** Never save `translation` from this; a saved pick comes from the picker. */
export type ShownTranslation = {
  /** The translation whose text shows for this chapter. */
  translation: CatalogTranslation
  reason: ShownTranslationReason
  /** The rules' choice before the book and device checks. */
  viewer: ViewerTranslation
}

export type ShownTranslationInput = ViewerTranslationInput & {
  /** The verse to show, in BSB numbering (R38). */
  ref: VerseRef
  /**
   * True after a chapter request got no answer (isNoNetworkFailure). U4 has
   * no network module, so the reader learns this from its last request.
   */
  offline: boolean
  /** Pass the repository's `isOnDevice` (U4's manifest and cache). */
  isOnDevice: (request: ChapterRequest) => Promise<boolean>
  /** Pass the repository's `translationHasBook`; the default reads the catalog. */
  hasBook?: (translation: CatalogTranslation, bookId: UsfmBookId) => boolean
}

/** U4's own test for "the network did not answer". */
export function isNoNetworkFailure(reason: ChapterFailureReason): boolean {
  return reason === "offline" || reason === "timeout"
}

/** The default translation for a language code, if the catalog has one. */
export function languageDefaultTranslationId(
  code: string | null,
  catalog: Catalog,
  languageDefaults: Readonly<
    Record<string, string>
  > = LANGUAGE_DEFAULT_TRANSLATIONS,
): string | null {
  const language = catalogLanguageCode(code, languageDefaults)
  const id = language == null ? undefined : languageDefaults[language]
  return id !== undefined && catalog.byId.has(id) ? id : null
}

export function chooseViewerTranslation(
  input: ViewerTranslationInput,
): ViewerTranslation {
  const { catalog, languageDefaults } = input
  const listed = (id: string | null): id is string =>
    id != null && catalog.byId.has(id)
  // A pick the catalog no longer lists falls through to the defaults.
  if (listed(input.sessionTranslationId)) {
    return { translationId: input.sessionTranslationId, source: "session" }
  }
  if (listed(input.explicitTranslationId)) {
    return { translationId: input.explicitTranslationId, source: "explicit" }
  }
  const audio = languageDefaultTranslationId(
    input.audioLanguage,
    catalog,
    languageDefaults,
  )
  if (audio != null) return { translationId: audio, source: "audio" }
  const phone = languageDefaultTranslationId(
    input.phoneLanguage,
    catalog,
    languageDefaults,
  )
  if (phone != null) return { translationId: phone, source: "phone" }
  return { translationId: BSB_TRANSLATION_ID, source: "bsb-default" }
}

/** A default is anything that the viewer did not choose (KD22). */
function isDefault(shown: ShownTranslation): boolean {
  return (
    shown.reason === "book-fallback" ||
    shown.viewer.source === "audio" ||
    shown.viewer.source === "phone"
  )
}

async function chapterOnDevice(
  input: ShownTranslationInput,
  translation: CatalogTranslation,
): Promise<boolean> {
  const { chapter } = toTranslationRef(input.ref, translation.id)
  try {
    return await input.isOnDevice({
      translationId: translation.id,
      bookId: input.ref.book,
      chapter,
      sha256: translation.sha256,
    })
  } catch {
    return false
  }
}

/**
 * The translation to show for `ref`. Null only for a catalog with no BSB,
 * which U3's build check refuses.
 */
export async function resolveShownTranslation(
  input: ShownTranslationInput,
): Promise<ShownTranslation | null> {
  const viewer = chooseViewerTranslation(input)
  const pick = pickTranslationForBook({
    catalog: input.catalog,
    bookId: input.ref.book,
    preferredId: viewer.translationId,
    fallbackId: languageDefaultTranslationId(
      input.phoneLanguage,
      input.catalog,
      input.languageDefaults,
    ),
    hasBook: input.hasBook,
  })
  if (pick == null) return null
  const shown: ShownTranslation = {
    translation: pick.translation,
    reason: pick.choice === "preferred" ? "viewer" : "book-fallback",
    viewer,
  }
  // R41: only a default gets the stand-in. A pick that is not on the device
  // offline gets R31's message, with its retry and its switch.
  if (
    !input.offline ||
    !isDefault(shown) ||
    shown.translation.id === BSB_TRANSLATION_ID
  ) {
    return shown
  }
  if (await chapterOnDevice(input, shown.translation)) return shown
  const bsb = input.catalog.byId.get(BSB_TRANSLATION_ID)
  return bsb ? { translation: bsb, reason: "offline-stand-in", viewer } : shown
}
