// The passage picker's steps (feat-553 U10, R17, KD15, R42). The chapter and
// verse steps show the shown translation's own numbers; the pick goes back to
// BSB numbering, because the saved position uses it (R38).
import { toBsbRef } from "../repository/resolveChapter"
import { BIBLE_BOOKS, type BibleBook, type UsfmBookId } from "../text/books"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import { mappedLastVerse, type VerseRef } from "../versification/convert"
import { translationBookSystem } from "../versification/translationSystems.generated"

/** The part of a catalog entry the picker reads. */
export type PassageTranslation = {
  id: string
  books: ReadonlySet<UsfmBookId>
}

export type PassageBook = {
  book: BibleBook
  /** False: the reader shows this book in another translation (R25). */
  inTranslation: boolean
}

// All 66 books. A book that the translation lacks stays, because the reader
// opens it through R25's fallback; hiding it would make it unreachable here.
export function passageBooks(
  translation: PassageTranslation | null,
): PassageBook[] {
  return BIBLE_BOOKS.map((book) => ({
    book,
    inTranslation: translation ? translation.books.has(book.usfm) : true,
  }))
}

/** The translation whose numbers the picker shows for one book. */
export function numberingFor(
  translation: PassageTranslation | null,
  bookId: UsfmBookId,
): string {
  return translation?.books.has(bookId) ? translation.id : BSB_TRANSLATION_ID
}

function lastVerse(
  numberingId: string,
  bookId: UsfmBookId,
  chapter: number,
): number | undefined {
  return mappedLastVerse(
    translationBookSystem(numberingId, bookId),
    bookId,
    chapter,
  )
}

function oneTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1)
}

export function chapterNumbers(
  numberingId: string,
  bookId: UsfmBookId,
): number[] {
  let count = 0
  while (lastVerse(numberingId, bookId, count + 1) !== undefined) count += 1
  return oneTo(count)
}

export function verseNumbers(
  numberingId: string,
  bookId: UsfmBookId,
  chapter: number,
): number[] {
  return oneTo(lastVerse(numberingId, bookId, chapter) ?? 0)
}

/** The pick in BSB numbering, for `moveTo`. */
export function pickedBsbRef(numberingId: string, ref: VerseRef): VerseRef {
  return toBsbRef(ref, numberingId)
}
