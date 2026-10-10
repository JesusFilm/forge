// A switch to a partial Bible that lacks the current book (owner, 2026-09-28).
// The reader warns first, then opens the translation at its start. Your place
// in the book does not carry over, because the translation has no such book.
import type { UiT } from "../../../i18n/useT"
import type { CatalogTranslation } from "../data/catalog"
import { isBsbVerseRef } from "../position/snapshot"
import { toBsbRef } from "../repository/resolveChapter"
import { BIBLE_BOOKS, bookByUsfm, type UsfmBookId } from "../text/books"
import type { VerseRef } from "../versification/convert"

export type HasBook = (
  translation: CatalogTranslation,
  bookId: UsfmBookId,
) => boolean

/** The translation's first verse: its first book, at 1:1. */
export type TranslationStart = {
  /** In the translation's own numbering, for the words. */
  shown: VerseRef
  /** In BSB numbering, for the reading position (R38). */
  bsb: VerseRef
}

export function translationStart(
  translation: CatalogTranslation,
  hasBook: HasBook,
): TranslationStart | null {
  const book = BIBLE_BOOKS.find((item) => hasBook(translation, item.usfm))
  if (!book) return null
  const shown: VerseRef = { book: book.usfm, chapter: 1, verse: 1 }
  const bsb = toBsbRef(shown, translation.id)
  return { shown, bsb: isBsbVerseRef(bsb) ? bsb : shown }
}

export type PartialSwitchInput = {
  translation: CatalogTranslation
  /** The reading position, in BSB numbering. */
  ref: VerseRef | null
  /** The verse on screen, in the shown numbering, for the words. */
  shownRef: VerseRef | null
  hasBook: HasBook
}

export type PartialSwitch = {
  start: TranslationStart
  title: string
  message: string
  cancelLabel: string
  confirmLabel: string
}

function placeLabel(ref: VerseRef): string {
  return `${bookByUsfm(ref.book).name} ${ref.chapter}:${ref.verse}`
}

/** Null when the pick keeps the place: the translation has the book. */
export function partialSwitch(
  t: UiT<"BibleTranslationPicker">,
  input: PartialSwitchInput,
): PartialSwitch | null {
  const { translation, ref, hasBook } = input
  if (!ref || hasBook(translation, ref.book)) return null
  const start = translationStart(translation, hasBook)
  if (!start) return null
  return {
    start,
    title: t("partialSwitchTitle", {
      shortName: translation.shortName,
      bookName: bookByUsfm(ref.book).name,
    }),
    message: t("partialSwitchMessage", {
      name: translation.name,
      start: placeLabel(start.shown),
      place: placeLabel(input.shownRef ?? ref),
    }),
    cancelLabel: t("cancel"),
    confirmLabel: t("switch"),
  }
}
