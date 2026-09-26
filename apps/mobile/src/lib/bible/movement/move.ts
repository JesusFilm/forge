// The reader's moves (feat-553 KTD19, R12, R13, R14). One pure function per
// move, over the shown chapter's stops. A gap is a stop (R21), a merged range
// is one stop, and only the two ends of the Bible stop a move.
import { stopRange } from "../reader/labels"
import { BIBLE_BOOKS, bookOrder, type UsfmBookId } from "../text/books"
import type { ChapterPosition } from "../text/types"
import {
  mappedLastVerse,
  type VerseRef,
  type VersificationSystemId,
} from "../versification/convert"
import { translationBookSystem } from "../versification/translationSystems.generated"

export type MoveDirection = "forward" | "back"

/** A chapter's last verse, or undefined when the book has no such chapter. */
export type ChapterNumbering = (
  book: UsfmBookId,
  chapter: number,
) => number | undefined

export function systemNumbering(
  system: VersificationSystemId,
): ChapterNumbering {
  return (book, chapter) => mappedLastVerse(system, book, chapter)
}

export const BSB_NUMBERING: ChapterNumbering = systemNumbering("bsb")

/** A translation's own numbering, book by book (R42). */
export function translationNumbering(translationId: string): ChapterNumbering {
  return (book, chapter) =>
    mappedLastVerse(translationBookSystem(translationId, book), book, chapter)
}

/** Where a chapter change lands. */
export type ChapterTarget = {
  ref: VerseRef
  /** `shown`: the shown translation's numbers, in the same book. `bsb`:
   *  another book, in BSB numbers, because R25 picks its translation later. */
  numbering: "shown" | "bsb"
}

export type MoveResult =
  /** A neighbor stop in the same chapter; `ref` is its first verse. */
  | { kind: "verse"; stopIndex: number; ref: VerseRef }
  | { kind: "chapter"; target: ChapterTarget }
  /** Genesis 1:1 going back, or Revelation 22:21 going forward. */
  | { kind: "stop"; edge: "start" | "end" }

export type VerseMoveInput = {
  book: UsfmBookId
  /** The chapter number in the shown numbering. */
  chapter: number
  stops: readonly ChapterPosition[]
  stopIndex: number
  direction: MoveDirection
  /** The shown translation's numbering for `book`. */
  numbering: ChapterNumbering
}

export type ChapterMoveInput = Omit<VerseMoveInput, "stops" | "stopIndex">

type Neighbor = {
  book: UsfmBookId
  chapter: number
  lastVerse: number
  numbering: ChapterTarget["numbering"]
}

function lastChapterOf(numbering: ChapterNumbering, book: UsfmBookId): number {
  let chapter = 1
  while (numbering(book, chapter + 1) !== undefined) chapter += 1
  return chapter
}

function neighbor(
  book: UsfmBookId,
  chapter: number,
  direction: MoveDirection,
  numbering: ChapterNumbering,
): Neighbor | null {
  if (direction === "forward") {
    const lastVerse = numbering(book, chapter + 1)
    if (lastVerse !== undefined) {
      return { book, chapter: chapter + 1, lastVerse, numbering: "shown" }
    }
    const next = BIBLE_BOOKS[bookOrder(book) + 1]
    const firstLast = next && BSB_NUMBERING(next.usfm, 1)
    return next && firstLast !== undefined
      ? { book: next.usfm, chapter: 1, lastVerse: firstLast, numbering: "bsb" }
      : null
  }
  if (chapter > 1) {
    // Every system numbers a book's chapters from 1 with no hole.
    const lastVerse = numbering(book, chapter - 1) ?? 1
    return { book, chapter: chapter - 1, lastVerse, numbering: "shown" }
  }
  const previous = BIBLE_BOOKS[bookOrder(book) - 1]
  if (!previous) return null
  const lastChapter = lastChapterOf(BSB_NUMBERING, previous.usfm)
  return {
    book: previous.usfm,
    chapter: lastChapter,
    lastVerse: BSB_NUMBERING(previous.usfm, lastChapter) ?? 1,
    numbering: "bsb",
  }
}

function toChapter(
  input: ChapterMoveInput,
  landing: "first" | "last",
): MoveResult {
  const { book, chapter, direction, numbering } = input
  const next = neighbor(book, chapter, direction, numbering)
  if (!next) {
    return { kind: "stop", edge: direction === "forward" ? "end" : "start" }
  }
  const verse = landing === "first" ? 1 : next.lastVerse
  return {
    kind: "chapter",
    target: {
      ref: { book: next.book, chapter: next.chapter, verse },
      numbering: next.numbering,
    },
  }
}

/** R14: a verse move crosses chapter and book ends; back lands on the last verse. */
export function moveVerse(input: VerseMoveInput): MoveResult {
  const step = input.direction === "forward" ? 1 : -1
  const stopIndex = input.stopIndex + step
  const stop = input.stops[stopIndex]
  if (stop) {
    const ref = {
      book: input.book,
      chapter: input.chapter,
      verse: stopRange(stop).first,
    }
    return { kind: "verse", stopIndex, ref }
  }
  return toChapter(input, input.direction === "forward" ? "first" : "last")
}

/** R12: a chapter move opens verse 1 of the next or the previous chapter. */
export function moveChapter(input: ChapterMoveInput): MoveResult {
  return toChapter(input, "first")
}

/** R13: the chapter a chapter move opens, or null at an end of the Bible. */
export function neighborChapter(
  book: UsfmBookId,
  chapter: number,
  direction: MoveDirection,
  numbering: ChapterNumbering,
): { book: UsfmBookId; chapter: number } | null {
  const next = neighbor(book, chapter, direction, numbering)
  return next && { book: next.book, chapter: next.chapter }
}
