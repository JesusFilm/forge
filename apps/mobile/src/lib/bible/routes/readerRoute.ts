// The pushed reader's route contract (feat-551 U11, KTD9). A quote card (U12)
// pushes `readerHref(ref, "quote")`; `app/reader.tsx` reads the params back
// with `parseReaderRouteParams`. A bad param gives no start reference.
import { isBsbVerseRef } from "../position/snapshot"
import { isUsfmBookId } from "../text/books"
import type { VerseRef } from "../versification/convert"

/** `app/reader.tsx`. Not `/bible`: that is the Bible tab's URL (KTD9). */
export const READER_PATHNAME = "/reader"

/** Why a pushed reader opened; U14 logs it as `reader_source` (KTD18). */
export type ReaderPushSource = "quote" | "link"

/** Every value is a string, because a route param is text. */
export type ReaderRouteParams = {
  /** The book's USFM code, such as `JHN`, in BSB numbering (R38). */
  book: string
  chapter: string
  verse: string
  source: ReaderPushSource
}

export type ReaderHref = {
  pathname: typeof READER_PATHNAME
  params: ReaderRouteParams
}

/** What the route knows after the parse. */
export type ReaderRouteRequest = {
  /** A verse that BSB has; null makes the reader open the saved position. */
  startRef: VerseRef | null
  /** Only an exact "quote" is a quote. Anything else is a link. */
  source: ReaderPushSource
}

export function readerHref(
  ref: VerseRef,
  source: ReaderPushSource,
): ReaderHref {
  return {
    pathname: READER_PATHNAME,
    params: {
      book: ref.book,
      chapter: String(ref.chapter),
      verse: String(ref.verse),
      source,
    },
  }
}

const NUMBER_PART = /^\d{1,3}$/

function numberParam(value: unknown): number | null {
  return typeof value === "string" && NUMBER_PART.test(value)
    ? Number(value)
    : null
}

/** Never throws. R1: a link with no verse opens the chapter's verse 1. */
export function parseReaderRouteParams(
  params: Readonly<Record<string, unknown>>,
): ReaderRouteRequest {
  const source = params.source === "quote" ? "quote" : "link"
  const { book } = params
  const chapter = numberParam(params.chapter)
  const verse = params.verse === undefined ? 1 : numberParam(params.verse)
  if (typeof book !== "string" || !isUsfmBookId(book)) {
    return { startRef: null, source }
  }
  if (chapter === null || verse === null) return { startRef: null, source }
  const ref = { book, chapter, verse }
  return { startRef: isBsbVerseRef(ref) ? ref : null, source }
}
