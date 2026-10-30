// R31's switch: a translation that is on the device and has the book. The
// viewer's language comes first, then any other download, then BSB, which
// ships inside the app.
import type { Catalog, CatalogTranslation } from "../data/catalog"
import type { TranslationDownloadState } from "../repository/translationDownloads"
import type { UsfmBookId } from "../text/books"
import { BSB_TRANSLATION_ID } from "../versification/classify"

export type SwitchTargetInput = {
  catalog: Catalog
  /** The translation whose chapter did not load. */
  failing: CatalogTranslation
  bookId: UsfmBookId
  getState: (translationId: string) => TranslationDownloadState
}

export function onDeviceSwitchTarget(
  input: SwitchTargetInput,
): CatalogTranslation | null {
  const { catalog, failing, bookId } = input
  let otherLanguage: CatalogTranslation | null = null
  for (const translation of catalog.translations) {
    if (translation.id === failing.id) continue
    const state = input.getState(translation.id)
    if (state.kind !== "downloaded" || !state.books.has(bookId)) continue
    if (translation.language === failing.language) return translation
    otherLanguage ??= translation
  }
  if (otherLanguage) return otherLanguage
  const bsb = catalog.byId.get(BSB_TRANSLATION_ID)
  return bsb && bsb.id !== failing.id && bsb.books.has(bookId) ? bsb : null
}
