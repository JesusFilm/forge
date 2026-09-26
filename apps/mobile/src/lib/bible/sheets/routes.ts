// The reader sheets' route contract (feat-553 U10, KTD9). A reader control
// pushes `readerSheetHref(kind, context)`; the sheet route reads the params
// back with `parseReaderSheetParams`. A bad field reads as unknown.
import { isBsbVerseRef, isStorableTranslationId } from "../position/snapshot"
import { isUsfmBookId } from "../text/books"
import type { VerseRef } from "../versification/convert"

/** Root-stack routes: `app/reader-passage.tsx` and its two siblings. */
export const READER_SHEET_PATHNAMES = {
  passage: "/reader-passage",
  translation: "/reader-translation",
  settings: "/reader-settings",
} as const

export type ReaderSheetKind = keyof typeof READER_SHEET_PATHNAMES

/** What a reader control knows when it opens a sheet (U7's route context). */
export type ReaderSheetContext = {
  translation: { id: string } | null
  /** The verse in the shown translation's numbering (R42). */
  translationRef: VerseRef | null
  /** The reading position in BSB numbering (R38). */
  ref: VerseRef | null
  offline: boolean
}

/** Every value is a string, because a route param is text. */
export type ReaderSheetParams = {
  translation?: string
  /** BSB numbering, as `BOOK.chapter.verse`. */
  ref?: string
  /** The shown translation's numbering, as `BOOK.chapter.verse`. */
  shownRef?: string
  offline: "1" | "0"
}

export type ReaderSheetHref = {
  pathname: (typeof READER_SHEET_PATHNAMES)[ReaderSheetKind]
  params: ReaderSheetParams
}

/** What a sheet route knows after the parse. */
export type ReaderSheetRequest = {
  translationId: string | null
  ref: VerseRef | null
  translationRef: VerseRef | null
  offline: boolean
}

function refParam(ref: VerseRef): string {
  return `${ref.book}.${ref.chapter}.${ref.verse}`
}

export function readerSheetHref(
  kind: ReaderSheetKind,
  context: ReaderSheetContext,
): ReaderSheetHref {
  const params: ReaderSheetParams = { offline: context.offline ? "1" : "0" }
  if (context.translation) params.translation = context.translation.id
  if (context.ref) params.ref = refParam(context.ref)
  if (context.translationRef) {
    params.shownRef = refParam(context.translationRef)
  }
  return { pathname: READER_SHEET_PATHNAMES[kind], params }
}

const NUMBER_PART = /^\d{1,3}$/

/** `BOOK.chapter.verse` with a known book, chapter 1 or more, verse 0 or more. */
function parseRef(value: unknown): VerseRef | null {
  if (typeof value !== "string") return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [book = "", chapterText = "", verseText = ""] = parts
  if (!isUsfmBookId(book)) return null
  if (!NUMBER_PART.test(chapterText) || !NUMBER_PART.test(verseText)) {
    return null
  }
  const chapter = Number(chapterText)
  if (chapter < 1) return null
  return { book, chapter, verse: Number(verseText) }
}

/** Never throws. Each field reads alone, so one bad field loses only itself. */
export function parseReaderSheetParams(
  params: Readonly<Record<string, unknown>>,
): ReaderSheetRequest {
  const { translation, ref, shownRef, offline } = params
  const bsbRef = parseRef(ref)
  return {
    translationId: isStorableTranslationId(translation) ? translation : null,
    ref: bsbRef && isBsbVerseRef(bsbRef) ? bsbRef : null,
    translationRef: parseRef(shownRef),
    offline: offline === "1",
  }
}
