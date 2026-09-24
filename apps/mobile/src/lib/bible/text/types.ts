import type { UsfmBookId } from "./books"

/** Increase this when the stored shape changes, so readers refuse old files. */
export const BIBLE_TEXT_FORMAT_VERSION = 1

export type TextDirection = "ltr" | "rtl"

export type VerseLine = {
  /** Trimmed and never empty. Footnotes and headings are not in it. */
  text: string
  /** The poetry indent level (1 or more). A prose line has no value. */
  poem?: number
}

export type Verse = {
  /** The translation's own verse number (R42), not the BSB number. */
  number: number
  /**
   * The last verse number this text covers, only when the translation merges
   * verses: T4T John 4:6-8 is `{ number: 6, through: 8 }`. Read `verseThrough`.
   */
  through?: number
  /** One or more lines. Each poetry line is a separate line. */
  lines: VerseLine[]
}

export type Chapter = {
  number: number
  /**
   * The highest verse number in the chapter. The counter total and the
   * scrubber read this, not the catalog's `numberOfVerses` (KTD19).
   */
  lastVerse: number
  /** Verses in ascending order. A number that no verse covers is a gap (R21). */
  verses: Verse[]
}

export type TextHeader = {
  formatVersion: typeof BIBLE_TEXT_FORMAT_VERSION
  translationId: string
  bookId: UsfmBookId
  /** The translation's own short name for the book. */
  bookName: string
  textDirection: TextDirection
}

/** One book of one translation: the shape of every stored per-book file. */
export type BookText = TextHeader & { chapters: Chapter[] }

/** One chapter from a single-chapter source, with the same header. */
export type ChapterText = TextHeader & { chapter: Chapter }

export type TranslationText = {
  translationId: string
  textDirection: TextDirection
  /** Books in canon order. */
  books: BookText[]
  /** Source book ids outside the 66 (TOB, SIR, ESG), which the reader omits. */
  skippedBookIds: string[]
}

/** One reader stop in a chapter: a verse, or a gap that shows a note (R21). */
export type ChapterPosition =
  | { kind: "verse"; verse: Verse }
  | { kind: "gap"; number: number }

export type TextRejectReason =
  | "malformed-source"
  | "invalid-translation"
  | "invalid-text-direction"
  | "unknown-book"
  | "malformed-book"
  | "duplicate-book"
  | "no-books"
  | "malformed-chapter"
  | "invalid-chapter-number"
  | "duplicate-chapter"
  | "no-chapters"
  | "invalid-verse"
  | "no-verses"
  | "format-version"
  | "malformed-text"

export type TextRejection = {
  status: "rejected"
  reason: TextRejectReason
  bookId?: string
  chapterNumber?: number
}

export type TextResult<T> = { status: "ok"; value: T } | TextRejection
